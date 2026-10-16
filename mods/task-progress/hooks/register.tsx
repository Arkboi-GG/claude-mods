import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Step, Usage } from '../types'

const steps = atom({ plugin: 'task-progress', key: 'steps' } as const, [] as Step[])

const stoppedAt = atom({ plugin: 'task-progress', key: 'stoppedAt' } as const, 0)
const tick = atom({ plugin: 'task-progress', key: 'tick' } as const, 0)
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

// Marks when each step started, so its block can fill while it runs.
const stamp = (prev: Step[], next: Step[], now: number): Step[] =>
  next.map((s, i) => {
    if (s.status !== 'in_progress') return { content: s.content, status: s.status }
    const was = prev[i]
    return { content: s.content, status: s.status, startedAt: was?.status === 'in_progress' && was.startedAt ? was.startedAt : now }
  })

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
    // Once a second while a step runs, so its block keeps filling.
    $.clock.every(1000, async () => {
      const list = await read($, steps)
      if (list.some(st => st.status === 'in_progress') && (await read($, stoppedAt)) === 0) await update($, tick, n => n + 1)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshUsage($)
    const list = await read($, steps)
    const isOpen = list.length > 0 && list.some(st => st.status !== 'completed')
    await update($, stoppedAt, () => 0)
    if (isOpen) {
      const at = await $.clock.now()
      await update($, stoppedAt, () => at)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, steps, () => [])
    await update($, stoppedAt, () => 0)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.tool === 'TodoWrite') {
      const todos = (e as { todos?: Step[] }).todos ?? []
      await update($, steps, prev => stamp(prev, todos, now))
    } else if (e.tool === 'mcp__ccd_turn__update_plan') {
      await update($, steps, prev => stamp(prev, applyPlan(prev, e as Record<string, unknown>), now))
    } else if (e.tool === 'mcp__ccd_turn__wrap_up') {
      await update($, steps, prev => prev.map(s => ({ content: s.content, status: 'completed' as const })))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const list = await read($, steps)
    // Only while Claude works: then the bar stands in for the other stats bands,
    // keeping just the dev row; when the turn ends they come back.
    if (e.props.hasSurvey) return below

    const isOpen = list.length > 0 && list.some(st => st.status !== 'completed')
    // Paused: the turn ended with steps still open, so the bar stays, in amber.
    const isPaused = !e.props.isWorking && isOpen

    if (list.length === 0 || (!e.props.isWorking && !isPaused)) {
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
        <Box paddingX={1} justifyContent="space-between" alignItems="center" marginBottom={1}>
          <Svg source={rings.source} alt={rings.alt} />
          <Button key="compact" label="Compact" onPress={async () => {
            $.ui.toast('Compacting…')
            // Runs as if /compact was typed, once the session is idle. $.session.compact()
            // is not available in every host (desktop/SDK sessions reject it).
            try {
              await $.command.run({ command: 'compact' })
            } catch (err) {
              $.ui.toast(`Compact failed: ${String((err as Error)?.message ?? err)}`)
            }
          }} />
        </Box>
      )
      return below ? <Box flexDirection="column">{idle}{below}</Box> : idle
    }

    const { Box, Text, Svg } = $.ui.resolve(e)
    await read($, tick)
    const stopped = await read($, stoppedAt)
    const now = stopped || (await $.clock.now())
    const done = list.filter(s => s.status === 'completed').length
    const pct = Math.round((done / list.length) * 100)
    const label = `Tasks ${done}/${list.length}`

    // One block per step, a thin gap between them. A running step fills toward 90%
    // as time passes, a finished one is green, a paused one amber.
    const W = 640
    const H = 22
    const SEP = 3
    const n = list.length
    const bw = (W - SEP * (n - 1)) / n
    const fit = (t: string) => {
      const max = Math.max(3, Math.floor(bw / 7.2) - 1)
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    let blocks = ''
    list.forEach((st, i) => {
      const x = i * (bw + SEP)
      blocks += `<rect x="${x}" width="${bw}" height="${H}" fill="${TRACK}"/>`
      let text = fit(st.content)
      let color = '#9ca3af'
      if (st.status === 'completed') {
        blocks += `<rect x="${x}" width="${bw}" height="${H}" fill="#22c55e"/>`
        text = 'Completed'
        color = '#ffffff'
      } else if (st.status === 'in_progress') {
        const secs = Math.max(0, (now - (st.startedAt ?? now)) / 1000)
        const frac = 0.9 * (1 - Math.exp(-secs / 25))
        const fill = isPaused ? '#f59e0b' : `url(#g${i})`
        blocks +=
          `<defs><linearGradient id="g${i}" x1="0" x2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="0.55" stop-color="#a855f7"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs>` +
          `<rect x="${x}" width="${Math.max(4, bw * frac)}" height="${H}" fill="${fill}"/>`
        text = isPaused ? 'Paused' : 'In Progress'
        color = '#ffffff'
      }
      blocks += `<text x="${x + bw / 2}" y="${H / 2 + 4.2}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${color}">${esc(text)}</text>`
    })
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<defs><clipPath id="c"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath></defs>` +
      `<g clip-path="url(#c)">${blocks}</g></svg>`

    const row = (
      <Box paddingX={1} alignItems="center" marginBottom={1}>
        <Box flexShrink={0}>
          <Text color={isPaused ? '#f59e0b' : '#a855f7'}>● </Text>
        </Box>
        <Box flexShrink={0}>
          <Text bold>{label}  </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Svg source={source} alt={`${label}, ${pct}%${isPaused ? ', paused' : ''}`} />
        </Box>
        <Text dimColor>  {pct}%  </Text>
        <Text color={ORANGE}>×{list.length}</Text>
      </Box>
    )
    const devrow = findDevRow(below)
    return devrow ? <Box flexDirection="column">{row}{devrow}</Box> : row
  })
}
