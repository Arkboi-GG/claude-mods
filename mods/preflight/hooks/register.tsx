import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Check } from '../types'

const checksAtom = atom({ plugin: 'preflight', key: 'checks' } as const, [] as Check[])

const WIDE = 110

const gateAtom = atom({ plugin: 'preflight', key: 'gate' } as const, false)

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

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Files also change through the shell (a script that rewrites files, git pull, checkout, a formatter): the checks run after those calls too,
// or the bar keeps showing the result of an earlier moment, for example a failure seen halfway through a change.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const GLYPH = { idle: '·', running: '…', pass: '✓', fail: '✗' } as const
const COLOR = { idle: '#6b7280', running: '#f59e0b', pass: '#22c55e', fail: '#ef4444' } as const

type Def = { name: string; command: string }

let defs: Def[] = []
let timer: { cancel: () => void } | null = null
let isRunning = false
let isDirty = false
// A check that fails is run once more before it is shown as failed: a run that lands halfway through a change (some files written, others
// not yet) reports errors that are gone a moment later.
let retryOnFail = true

async function shell($: any, command: string) {
  try {
    return await $.process.run(['sh', '-c', command], { timeoutMs: 300000 })
  } catch {
    return await $.process.run(['cmd', '/c', command], { timeoutMs: 300000 })
  }
}

// No setting given: use tsc when there is a tsconfig, and any lint script.
async function detect($: any): Promise<Def[]> {
  const found: Def[] = []
  try {
    const probe = await shell($, 'test -f tsconfig.json || dir tsconfig.json')
    if (probe.exitCode === 0) found.push({ name: 'types', command: 'npx tsc -b' })
  } catch {
    // no shell: skip
  }
  try {
    const r = await shell($, 'npm pkg get scripts.lint')
    if (r.exitCode === 0 && r.stdout.trim() && r.stdout.trim() !== '{}') found.push({ name: 'lint', command: 'npm run lint' })
  } catch {
    // no npm: skip
  }
  return found
}

async function runAll($: any) {
  if (isRunning) {
    isDirty = true
    return
  }
  isRunning = true
  do {
    isDirty = false
    await update($, checksAtom, () => defs.map(d => ({ name: d.name, state: 'running' as const, issues: 0, at: 0 })))
    for (let i = 0; i < defs.length; i++) {
      let r
      try {
        r = await shell($, defs[i].command)
      } catch {
        r = { exitCode: 1, stdout: '', stderr: 'error: could not run' }
      }
      if (r.exitCode !== 0 && retryOnFail) {
        try {
          r = await shell($, defs[i].command)
        } catch {
          // keep the first result
        }
      }
      const out = `${r.stdout}\n${r.stderr}`
      const issues = r.exitCode === 0 ? 0 : Math.max(1, (out.match(/\berror\b/gi) ?? []).length)
      await update($, checksAtom, prev =>
        prev.map((c, k) => (k === i ? { ...c, state: r.exitCode === 0 ? ('pass' as const) : ('fail' as const), issues, at: Date.now() } : c)),
      )
    }
  } while (isDirty)
  isRunning = false
}

const parse = (s: string): Def[] =>
  s
    .split(';')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const i = p.indexOf('=')
      return i > 0 ? { name: p.slice(0, i).trim(), command: p.slice(i + 1).trim() } : { name: p.split(' ')[0], command: p }
    })

// The checks to run: the ones named in the `checks` option, else the ones found in the session's folder.
async function refresh($: any, setting: string) {
  defs = setting.trim() ? parse(setting) : await detect($)
  await update($, checksAtom, () => defs.map(d => ({ name: d.name, state: 'idle' as const, issues: 0, at: 0 })))
}

export const register: Register = (on, options) => {
  const githubOnly = options.githubOnly !== false

  const delayMs = Math.max(1, Number(options.delaySeconds ?? 8)) * 1000
  const afterShell = options.afterShell !== false
  retryOnFail = options.retryOnFail !== false

  on('session.start', async ($, e, next) => {
    await checkGate($, githubOnly)
    $.clock.every(15000, () => checkGate($, githubOnly))
    await refresh($, String(options.checks ?? ''))
    const result = await next(e)
    $.clock.after(1000, async () => {
      if (await read($, gateAtom)) runAll($)
    })
    return result
  })

  // The session moved to another folder (/cd, the host's folder picker, a worktree): look for its checks again.
  on('classic.CwdChanged', async ($, e, next) => {
    timer?.cancel()
    await checkGate($, githubOnly)
    await refresh($, String(options.checks ?? ''))
    if (defs.length > 0 && (await read($, gateAtom))) timer = $.clock.after(1000, () => runAll($))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const tool = String(e.tool)
    if ((EDIT_TOOLS.has(tool) || (afterShell && SHELL_TOOLS.has(tool))) && defs.length > 0 && (await read($, gateAtom))) {
      timer?.cancel()
      timer = $.clock.after(delayMs, () => runAll($))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const checks = await read($, checksAtom)
    if (e.props.hasSurvey || checks.length === 0 || !(await read($, gateAtom))) return below

    const { Box, Text } = $.ui.resolve(e)
    const isWide = e.props.bodyColumns >= WIDE
    const clock = (at: number) => (at ? new Date(at).toTimeString().slice(0, 5) : '')
    const zone = (
      <Box gap={2}>
        {checks.map(c => (
          <Box key={c.name} gap={1}>
            <Text color={COLOR[c.state]}>{GLYPH[c.state]}</Text>
            <Text dimColor={c.state === 'pass' || c.state === 'idle'}>{c.name}</Text>
            {c.state === 'fail' ? <Text color="#ef4444">{c.issues}</Text> : null}
            {c.state === 'idle' ? <Text dimColor>not run</Text> : null}
            {isWide && c.at ? <Text dimColor>{clock(c.at)}</Text> : null}
          </Box>
        ))}
      </Box>
    )
    return addZone(below, zone, 3)
  })
}
