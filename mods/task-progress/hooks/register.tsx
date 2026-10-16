import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Step, Usage } from '../types'

const steps = atom({ plugin: 'task-progress', key: 'steps' } as const, [] as Step[])

const usage = atom({ plugin: 'task-progress', key: 'usage' } as const, { context: null, limits: [] } as Usage)

const ORANGE = '#f97316'
const TRACK = '#2b2b2b'
const STOPS: Array<[number, number, number]> = [
  [99, 102, 241],
  [168, 85, 247],
  [244, 114, 182],
]

const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

// Colour at t (0..1) along the gradient.
const grad = (t: number) => {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  return hex(STOPS[i].map((v, k) => v + (STOPS[i + 1][k] - v) * f))
}

// Applies one update_plan call (the desktop app's task list) to the steps.
const applyPlan = (prev: Step[], e: Record<string, unknown>): Step[] => {
  if (Array.isArray(e.items)) {
    return (e.items as Array<{ content?: string; status?: Step['status'] }>).map(i => ({
      content: String(i.content ?? ''),
      status: i.status ?? 'pending',
    }))
  }
  const next = prev.map(s => ({ ...s }))
  if (e.advance === true) {
    const cur = next.findIndex(s => s.status === 'in_progress')
    if (cur >= 0) next[cur].status = 'completed'
    const nxt = next.findIndex(s => s.status === 'pending')
    if (nxt >= 0) next[nxt].status = 'in_progress'
  }
  if (Array.isArray(e.done)) {
    for (const n of e.done as number[]) if (next[n - 1]) next[n - 1].status = 'completed'
  }
  if (typeof e.start === 'number' && next[e.start - 1]) next[e.start - 1].status = 'in_progress'
  return next
}

// The dev row the sibling mods build (key 'devrow'), found anywhere in what is beneath.
function findDevRow(node: any): any {
  if (!node || typeof node !== 'object') return null
  if (node.props?.key === 'devrow') return node
  for (const kid of node.children ?? []) {
    const hit = findDevRow(kid)
    if (hit) return hit
  }
  return null
}

// 'five_hour' -> '5h', 'seven_day' -> '7d'; any other window keeps its own name.
function limitLabel(kind: string): string {
  const k = kind.toLowerCase()
  if (k.includes('five') || k.includes('5h') || k.includes('5_h')) return '5h'
  if (k.includes('seven') || k.includes('7d') || k.includes('week')) return '7d'
  return k.replace(/_/g, ' ')
}

// The idle band: a ring per meter (context, 5-hour and 7-day limits), drawn as one SVG.
function ringsSvg(meters: Array<{ label: string; percent: number }>) {
  const R = 11
  const C = 2 * Math.PI * R
  let x = 0
  let body = ''
  const alt: string[] = []
  for (const m of meters) {
    const pct = Math.max(0, Math.min(100, Math.round(m.percent)))
    const text = `${pct}% ${m.label}`
    const w = Math.ceil(R * 2 + 14 + text.length * 7.6 + 26)
    const cx = x + R + 4
    const color = pct >= 95 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#a78bfa'
    const dash = (C * pct) / 100
    body +=
      `<circle cx="${cx}" cy="15" r="${R}" fill="none" stroke="#8b8b9b" stroke-opacity=".25" stroke-width="3"/>` +
      `<circle cx="${cx}" cy="15" r="${R}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${dash} ${C}" transform="rotate(-90 ${cx} 15)"/>` +
      `<text x="${cx + R + 8}" y="19.5" font-family="system-ui,sans-serif" font-size="13"><tspan fill="#ffffff" font-weight="600">${pct}%</tspan><tspan fill="#7c8bd4"> ${m.label}</tspan></text>`
    alt.push(`${m.label} ${pct}%`)
    x += w
  }
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="30" viewBox="0 0 ${x} 30">${body}</svg>`,
    alt: alt.join(', '),
  }
}

async function refreshUsage($: any) {
  try {
    const u = await $.session.usage()
    const snap: Usage = {
      context: u.context?.percent ?? null,
      limits: (u.rateLimits ?? []).map((l: any) => ({ label: limitLabel(String(l.kind)), percent: Number(l.percentUsed) })),
    }
    await update($, usage, prev => (JSON.stringify(prev) === JSON.stringify(snap) ? prev : snap))
  } catch {
    // no usage figures yet: keep the last reading
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.toast('task-progress loaded')
    await refreshUsage($)
    $.clock.every(60000, () => refreshUsage($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshUsage($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, steps, () => [])
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'TodoWrite') {
      const todos = (e as { todos?: Step[] }).todos ?? []
      await update($, steps, () => todos.map(t => ({ content: t.content, status: t.status })))
    } else if (e.tool === 'mcp__ccd_turn__update_plan') {
      await update($, steps, prev => applyPlan(prev, e as Record<string, unknown>))
    } else if (e.tool === 'mcp__ccd_turn__wrap_up') {
      await update($, steps, prev => prev.map(s => ({ ...s, status: 'completed' as const })))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const list = await read($, steps)
    // Only while Claude works: then the bar stands in for the other stats bands,
    // keeping just the dev row; when the turn ends they come back.
    if (e.props.hasSurvey) return below

    if (list.length === 0 || !e.props.isWorking) {
      // Idle: the usage rings, with a Compact button on the right.
      const u = await read($, usage)
      const meters = [...(u.context === null ? [] : [{ label: 'context', percent: u.context }]), ...u.limits]
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      if (meters.length === 0) {
        const wait = (
          <Box paddingX={1}>
            <Text dimColor>usage: waiting for the first reading</Text>
          </Box>
        )
        return below ? <Box flexDirection="column">{wait}{below}</Box> : wait
      }
      const rings = ringsSvg(meters)
      const idle = (
        <Box paddingX={1} justifyContent="space-between" alignItems="center">
          <Svg source={rings.source} alt={rings.alt} />
          <Button key="compact" label="Compact" onPress={() => $.session.compact()} />
        </Box>
      )
      return below ? <Box flexDirection="column">{idle}{below}</Box> : idle
    }

    const { Box, Text, Svg } = $.ui.resolve(e)
    const done = list.filter(s => s.status === 'completed').length
    const current = list.find(s => s.status === 'in_progress')
    const pct = Math.round((done / list.length) * 100)
    const finished = done === list.length

    const title = finished ? 'Done' : (current?.content ?? 'Task')
    const shown = title.length > 30 ? title.slice(0, 29) + '…' : title
    const label = `Tasks ${done}/${list.length}`
    // The bar takes what the title leaves, so the row never wraps.
    const W = Math.max(160, 700 - 8 * shown.length)
    const H = 22
    const fillW = done === 0 ? 0 : Math.max(H, Math.round((done / list.length) * W))
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="0.55" stop-color="#a855f7"/><stop offset="1" stop-color="#f472b6"/></linearGradient>` +
      `<clipPath id="c"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath></defs>` +
      `<g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="${TRACK}"/>` +
      (fillW > 0 ? `<rect width="${fillW}" height="${H}" rx="${H / 2}" fill="url(#g)"/>` : '') +
      `</g><text x="${W / 2}" y="${H / 2 + 4.5}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#ffffff">${label}</text></svg>`

    const row = (
      <Box paddingX={1} alignItems="center">
        <Box flexShrink={0}>
          <Text color="#a855f7">● </Text>
        </Box>
        <Box flexShrink={0}>
          <Text bold wrap="truncate">{shown}  </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Svg source={source} alt={`${label}, ${pct}%`} />
        </Box>
        <Text dimColor>  {pct}%  </Text>
        <Text color={ORANGE}>×{list.length}</Text>
      </Box>
    )
    const devrow = findDevRow(below)
    return devrow ? <Box flexDirection="column">{row}{devrow}</Box> : row
  })
}
