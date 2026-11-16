import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Repo } from '../types'

const repoAtom = atom({ plugin: 'repo-status', key: 'repo' } as const, {} as Record<string, Repo | null>)

const WIDE = 110

// Every session keeps its own readings: each value is a map keyed by the session id.
async function sid($: any): Promise<string> {
  try {
    return String(await $.session.id())
  } catch {
    return 'main'
  }
}

const gateAtom = atom({ plugin: 'repo-status', key: 'gate' } as const, {} as Record<string, boolean>)

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
  // The engine may prefix a key with the plugin's name: match the ending, sort on the number.
  const rank = (n: any) => Number(/zone-(d+)$/.exec(String(n?.props?.key))?.[1] ?? 99)
  const byKey = (a: any, b: any) => rank(a) - rank(b)
  const merge = (node: any): any => {
    if (!node || typeof node !== 'object') return null
    if (/(^|[^a-z])devrow$/.test(String(node.props?.key))) return withKids(node, [...kidsOf(node), tagged].sort(byKey))
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

export const register: Register = (on, options) => {
  const githubOnly = options.githubOnly !== false

  // The session moved to another folder: check it again.
  on('classic.CwdChanged', async ($, e, next) => {
    await checkGate($, githubOnly)
    return next(e)
  })

  const wantPr = options.showPullRequest !== false
  on('session.start', async ($, e, next) => {
    const id = await sid($)
    let prText = ''
    let prLong = ''
    let prAt = 0
    await checkGate($, githubOnly)
    $.clock.every(15000, () => checkGate($, githubOnly))
    const poll = async () => {
      if (!(await gateOn($))) return
      try {
        const st = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { timeoutMs: 8000 })
        if (st.exitCode !== 0) return update($, repoAtom, p => ({ ...p, [id]: null }))
        const lines = st.stdout.split('\n').filter(Boolean)
        const head = lines[0] ?? ''
        const branch = head.replace(/^## /, '').replace(/^No commits yet on /, '').split('...')[0].split(' ')[0]
        const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
        const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)

        const now = await $.clock.now()
        if (wantPr && now - prAt > 60000) {
          prAt = now
          try {
            const pr = await $.process.run(['gh', 'pr', 'view', '--json', 'number,state,statusCheckRollup'], { timeoutMs: 15000 })
            if (pr.exitCode === 0) {
              const j = JSON.parse(pr.stdout)
              const checks: Array<{ conclusion?: string; status?: string }> = j.statusCheckRollup ?? []
              const bad = checks.some(c => ['FAILURE', 'CANCELLED', 'TIMED_OUT'].includes(c.conclusion ?? ''))
              const pending = checks.some(c => c.status !== 'COMPLETED')
              const mark = j.state === 'MERGED' ? 'merged' : bad ? '✗' : pending ? '…' : '✓'
              prText = `PR #${j.number} ${mark}`
              prLong = j.state === 'MERGED' ? 'merged' : bad ? 'checks failing' : pending ? 'checks running' : 'checks passing'
            } else {
              prText = ''
              prLong = ''
            }
          } catch {
            prText = ''
            prLong = ''
          }
        }
        await update($, repoAtom, p => ({ ...p, [id]: { branch, ahead, behind, changed: lines.length - 1, pr: prText, prLong } }))
      } catch {
        // git missing or timed out: keep the last reading
      }
    }
    await poll()
    $.clock.every(5000, poll)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const repo = (await read($, repoAtom))[await sid($)] ?? null
    if (e.props.hasSurvey || !repo || !(await gateOn($))) return below

    try {
      await $.fs.write('C:/Users/Panos/AppData/Local/Temp/claude/devrow-debug.json', JSON.stringify(below, null, 1).slice(0, 6000))
    } catch {
      // debug only
    }
    const { Box, Text } = $.ui.resolve(e)
    const isWide = e.props.bodyColumns >= WIDE
    const dirty = repo.changed > 0
    const prColor = repo.pr.includes('✗') ? '#ef4444' : repo.pr.includes('…') ? '#f59e0b' : '#22c55e'

    const zone = (
      <Box gap={2}>
        <Text bold color="#a855f7">{repo.branch}</Text>
        {repo.ahead > 0 || repo.behind > 0 || isWide ? <Text dimColor>↑{repo.ahead} ↓{repo.behind}</Text> : null}
        <Text color={dirty ? '#f59e0b' : '#22c55e'}>{dirty ? `● ${repo.changed} changed` : '✓ clean'}</Text>
        {repo.pr ? <Text color={prColor}>{isWide && repo.prLong ? `${repo.pr.split(' ').slice(0, 2).join(' ')} · ${repo.prLong}` : repo.pr}</Text> : null}
      </Box>
    )
    return addZone(below, zone, 1)
  })
}
