import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Repo } from '../types'

const repoAtom = atom({ plugin: 'repo-status', key: 'repo' } as const, null as Repo | null)

export const register: Register = (on, options) => {
  const wantPr = options.showPullRequest !== false
  let prText = ''
  let prAt = 0

  on('session.start', async ($, e, next) => {
    const poll = async () => {
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
            const pr = await $.process.run(
              ['gh', 'pr', 'view', '--json', 'number,state,statusCheckRollup'],
              { timeoutMs: 15000 },
            )
            if (pr.exitCode === 0) {
              const j = JSON.parse(pr.stdout)
              const checks: Array<{ conclusion?: string; status?: string }> = j.statusCheckRollup ?? []
              const bad = checks.some(c => ['FAILURE', 'CANCELLED', 'TIMED_OUT'].includes(c.conclusion ?? ''))
              const pending = checks.some(c => c.status !== 'COMPLETED')
              const mark = j.state === 'MERGED' ? 'merged' : bad ? '✗' : pending ? '…' : '✓'
              prText = `PR #${j.number} ${mark}`
            } else prText = ''
          } catch {
            prText = ''
          }
        }
        await update($, repoAtom, () => ({ branch, ahead, behind, changed: lines.length - 1, pr: prText }))
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
    if (e.props.hasSurvey || !repo) return below

    const { Box, Text } = $.ui.resolve(e)
    const dirty = repo.changed > 0

    const row = (
      <Box paddingX={1} gap={2}>
        <Text bold color="#a855f7">⎇ {repo.branch}</Text>
        {repo.ahead > 0 || repo.behind > 0 ? (
          <Text dimColor>↑{repo.ahead} ↓{repo.behind}</Text>
        ) : null}
        <Text color={dirty ? '#f59e0b' : '#22c55e'}>
          {dirty ? `● ${repo.changed} changed` : '✓ clean'}
        </Text>
        {repo.pr ? <Text color={repo.pr.includes('✗') ? '#ef4444' : repo.pr.includes('…') ? '#f59e0b' : '#22c55e'}>{repo.pr}</Text> : null}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{row}</Box> : row
  })
}
