import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Dot } from '../types'

const dotsAtom = atom({ plugin: 'stack-health', key: 'dots' } as const, {} as Record<string, Dot[]>)

const WIDE = 110

// Every session keeps its own readings: each value is a map keyed by the session id.
async function sid($: any): Promise<string> {
  try {
    return String(await $.session.id())
  } catch {
    return 'main'
  }
}

const gateAtom = atom({ plugin: 'stack-health', key: 'gate' } as const, {} as Record<string, boolean>)

// The bars only show in a GitHub repository: true when the session's folder is inside a git
// repository whose remote is on GitHub (any git repository when `githubOnly` is off).
async function inGithubRepo($: any, githubOnly: boolean): Promise<boolean> {
  try {
    const r = await $.process.run(['git', 'remote', '-v'], { timeoutMs: 5000 })
    if (r.exitCode !== 0) return false
    return !githubOnly || /github\.com/i.test(r.stdout)
  } catch {
    return false
  }
}

async function checkGate($: any, githubOnly: boolean) {
  const ok = await inGithubRepo($, githubOnly)
  const id = await sid($)
  await update($, gateAtom, p => (p[id] === ok ? p : { ...p, [id]: ok }))
}

async function gateOn($: any): Promise<boolean> {
  return (await read($, gateAtom))[await sid($)] === true
}

// A node's children sit either beside its props or among them, by engine build: read and write both.
function kidsOf(node: any): any[] {
  const k = Array.isArray(node?.children) ? node.children : node?.props?.children
  if (k === undefined || k === null) return []
  return (Array.isArray(k) ? k : [k]).flat(Infinity).filter((x: any) => x !== null && x !== undefined && x !== false)
}

function withKids(node: any, kids: any[]): any {
  if (node?.children === undefined && node?.props && 'children' in node.props) return { ...node, props: { ...node.props, children: kids } }
  return { ...node, children: kids }
}

// Shared "dev row" protocol (the same helper sits in every mod of this repo):
// each mod adds a keyed zone to one row, so the mods fill a single line together
// and still work alone. Zones sort by their key, `zone-<order>`.
function addZone(below: any, zone: any, order: number): any {
  const tagged = { ...zone, props: { ...zone.props, key: `zone-${order}`, flexShrink: 0 } }
  const byKey = (a: any, b: any) => String(a?.props?.key).localeCompare(String(b?.props?.key))
  const merge = (node: any): any => {
    if (!node || typeof node !== 'object') return null
    if (node.props?.key === 'devrow') return withKids(node, [...kidsOf(node), tagged].sort(byKey))
    const kids: any[] = kidsOf(node)
    for (let i = 0; i < kids.length; i++) {
      const hit = merge(kids[i])
      if (hit) return withKids(node, kids.map((k, j) => (j === i ? hit : k)))
    }
    return null
  }
  const merged = merge(below)
  if (merged) return merged
  const row = {
    type: 'Box',
    props: { key: 'devrow', paddingX: 1, justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 3 },
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
  const githubOnly = options.githubOnly !== false

  // The session moved to another folder: check it again.
  on('classic.CwdChanged', async ($, e, next) => {
    await checkGate($, githubOnly)
    return next(e)
  })

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
    const id = await sid($)
    await checkGate($, githubOnly)
    $.clock.every(15000, () => checkGate($, githubOnly))
    const poll = async () => {
      if (!(await gateOn($))) {
        await update($, dotsAtom, p => (p[id]?.length ? { ...p, [id]: [] } : p))
        return
      }
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

      await update($, dotsAtom, p => ({ ...p, [id]: dots }))
    }
    await poll()
    $.clock.every(10000, poll)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const dots = (await read($, dotsAtom))[await sid($)] ?? []
    if (e.props.hasSurvey || dots.length === 0 || !(await gateOn($))) return below

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
