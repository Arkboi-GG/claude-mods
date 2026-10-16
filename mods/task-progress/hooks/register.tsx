import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Step } from '../types'

const steps = atom({ plugin: 'task-progress', key: 'steps' } as const, [] as Step[])

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

export const register: Register = on => {
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
    if (e.props.hasSurvey || list.length === 0) return below

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
    return below ? <Box flexDirection="column">{below}{row}</Box> : row
  })
}
