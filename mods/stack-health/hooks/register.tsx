import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Dot } from '../types'

const dotsAtom = atom({ plugin: 'stack-health', key: 'dots' } as const, [] as Dot[])

const WIDE = 110

// Shared "dev row" protocol (the same helper sits in every mod of this repo):
// each mod adds a keyed zone to one row, so the mods fill a single line together
// and still work alone. Zones sort by their key, `zone-<order>`.
function addZone(below: any, zone: any, order: number): any {
  const tagged = { ...zone, props: { ...zone.props, key: `zone-${order}` } }
  const byKey = (a: any, b: any) => String(a?.props?.key).localeCompare(String(b?.props?.key))
  const merge = (node: any): any => {
    if (!node || typeof node !== 'object') return null
    if (node.props?.key === 'devrow') return { ...node, children: [...(node.children ?? []), tagged].sort(byKey) }
    const kids: any[] = node.children ?? []
    for (let i = 0; i < kids.length; i++) {
      const hit = merge(kids[i])
      if (hit) return { ...node, children: kids.map((k, j) => (j === i ? hit : k)) }
    }
    return null
  }
  const merged = merge(below)
  if (merged) return merged
  const row = {
    type: 'Box',
    props: { key: 'devrow', paddingX: 1, justifyContent: 'space-between', gap: 3 },
    children: [tagged],
  }
  return {
    type: 'Box',
    props: { flexDirection: 'column' },
    children: below ? [below, row] : [row],
  }
}

const COLORS = { up: '#22c55e', wait: '#f59e0b', down: '#ef4444' } as const

export const register: Register = (on, options) => {
  const wantCompose = options.compose !== false
  const ports = String(options.ports ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const [a, b] = s.split('=')
      return b ? { name: a.trim(), port: b.trim() } : { name: `:${a}`, port: a }
    })

  on('session.start', async ($, e, next) => {
    const poll = async () => {
      const dots: Dot[] = []

      if (wantCompose) {
        try {
          const r = await $.process.run(['docker', 'compose', 'ps', '--all', '--format', 'json'], { timeoutMs: 10000 })
          if (r.exitCode === 0) {
            const text = r.stdout.trim()
            const rows: Array<{ Service?: string; State?: string; Health?: string; Status?: string }> = text.startsWith('[')
              ? JSON.parse(text)
              : text.split('\n').filter(Boolean).map(l => JSON.parse(l))
            for (const row of rows) {
              const state =
                row.State === 'running' ? (row.Health === 'starting' ? 'wait' : row.Health === 'unhealthy' ? 'down' : 'up')
                : row.State === 'restarting' || row.State === 'created' ? 'wait'
                : 'down'
              dots.push({ name: row.Service ?? '?', state, detail: (row.Status ?? '').replace(/^Up /i, '').replace(/ \(.*\)/, '').toLowerCase() })
            }
          }
        } catch {
          // docker not installed or daemon down: no compose dots
        }
      }

      for (const p of ports) {
        try {
          await $.http.fetch(`http://localhost:${p.port}/`)
          dots.push({ name: p.name, state: 'up', detail: `:${p.port}` })
        } catch {
          dots.push({ name: p.name, state: 'down', detail: `:${p.port}` })
        }
      }

      await update($, dotsAtom, () => dots)
    }
    await poll()
    $.clock.every(10000, poll)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const dots = await read($, dotsAtom)
    if (e.props.hasSurvey || dots.length === 0) return below

    const { Box, Text } = $.ui.resolve(e)
    const isWide = e.props.bodyColumns >= WIDE
    const zone = (
      <Box gap={2}>
        {dots.map(d => (
          <Box key={d.name} gap={1}>
            <Text color={COLORS[d.state]}>●</Text>
            <Text dimColor={d.state === 'up'}>{d.name}</Text>
            {isWide && d.detail ? <Text dimColor>{d.detail}</Text> : null}
          </Box>
        ))}
      </Box>
    )
    return addZone(below, zone, 2)
  })
}
