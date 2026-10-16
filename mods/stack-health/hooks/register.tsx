import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Dot } from '../types'

const dotsAtom = atom({ plugin: 'stack-health', key: 'dots' } as const, [] as Dot[])

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
            const rows: Array<{ Service?: string; State?: string; Health?: string }> = text.startsWith('[')
              ? JSON.parse(text)
              : text.split('\n').filter(Boolean).map(l => JSON.parse(l))
            for (const row of rows) {
              const state =
                row.State === 'running' ? (row.Health === 'starting' ? 'wait' : row.Health === 'unhealthy' ? 'down' : 'up')
                : row.State === 'restarting' || row.State === 'created' ? 'wait'
                : 'down'
              dots.push({ name: row.Service ?? '?', state })
            }
          }
        } catch {
          // docker not installed or daemon down: no compose dots
        }
      }

      for (const p of ports) {
        try {
          await $.http.fetch(`http://localhost:${p.port}/`)
          dots.push({ name: p.name, state: 'up' })
        } catch {
          dots.push({ name: p.name, state: 'down' })
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
    const row = (
      <Box paddingX={1} gap={2}>
        {dots.map(d => (
          <Box key={d.name} gap={1}>
            <Text color={COLORS[d.state]}>●</Text>
            <Text dimColor={d.state === 'up'}>{d.name}</Text>
          </Box>
        ))}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{row}</Box> : row
  })
}
