import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Repo } from '../types'

const repoAtom = atom({ plugin: 'repo-status', key: 'repo' } as const, null as Repo | null)

const WIDE = 110

const gateAtom = atom({ plugin: 'repo-status', key: 'gate' } as const, false)

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
  await update($, gateAtom, p => (p === ok ? p : ok))
}

// Shared "dev row" protocol (the same helper sits in every mod of this repo):
// each mod adds a keyed zone to one row, so the mods fill a single line together
// and still work alone. Zones sort by their key, `zone-<order>`.
function addZone(below: any, zone: any, order: number): any {
  const tagged = { ...zone, props: { ...zone.props, key: `zone-${order}`, flexShrink: 0 } }
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
  let prText = ''
  let prLong = ''
  let prAt = 0

  on('session.start', async ($, e, next) => {
    await checkGate($, githubOnly)
    $.clock.every(15000, () => checkGate($, githubOnly))
    const poll = async () => {
      if (!(await read($, gateAtom))) return
      try {
        const st = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { timeoutMs: 8000 })
        if (st.exitCode !== 0) return update($, repoAtom, () => null)
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
        await update($, repoAtom, () => ({ branch, ahead, behind, changed: lines.length - 1, pr: prText, prLong }))
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
    const repo = await read($, repoAtom)
    if (e.props.hasSurvey || !repo || !(await read($, gateAtom))) return below

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
