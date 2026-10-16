import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Check } from '../types'

const checksAtom = atom({ plugin: 'preflight', key: 'checks' } as const, [] as Check[])

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const GLYPH = { idle: '○', running: '…', pass: '✓', fail: '✗' } as const
const COLOR = { idle: '#6b7280', running: '#f59e0b', pass: '#22c55e', fail: '#ef4444' } as const

type Def = { name: string; command: string }

let defs: Def[] = []
let timer: { cancel: () => void } | null = null
let isRunning = false
let isDirty = false

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
    await update($, checksAtom, () => defs.map(d => ({ name: d.name, state: 'running' as const, issues: 0 })))
    for (let i = 0; i < defs.length; i++) {
      let r
      try {
        r = await shell($, defs[i].command)
      } catch {
        r = { exitCode: 1, stdout: '', stderr: 'error: could not run' }
      }
      const out = `${r.stdout}\n${r.stderr}`
      const issues = r.exitCode === 0 ? 0 : Math.max(1, (out.match(/\berror\b/gi) ?? []).length)
      await update($, checksAtom, prev =>
        prev.map((c, k) => (k === i ? { ...c, state: r.exitCode === 0 ? ('pass' as const) : ('fail' as const), issues } : c)),
      )
    }
  } while (isDirty)
  isRunning = false
}

export const register: Register = (on, options) => {
  const delayMs = Math.max(1, Number(options.delaySeconds ?? 8)) * 1000

  const parse = (s: string): Def[] =>
    s
      .split(';')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const i = p.indexOf('=')
        return i > 0 ? { name: p.slice(0, i).trim(), command: p.slice(i + 1).trim() } : { name: p.split(' ')[0], command: p }
      })

  on('session.start', async ($, e, next) => {
    defs = String(options.checks ?? '').trim() ? parse(String(options.checks)) : await detect($)
    await update($, checksAtom, () => defs.map(d => ({ name: d.name, state: 'idle' as const, issues: 0 })))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (EDIT_TOOLS.has(String(e.tool)) && defs.length > 0) {
      timer?.cancel()
      timer = $.clock.after(delayMs, () => runAll($))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const checks = await read($, checksAtom)
    if (e.props.hasSurvey || checks.length === 0) return below

    const { Box, Text } = $.ui.resolve(e)
    const row = (
      <Box paddingX={1} gap={2}>
        {checks.map(c => (
          <Box key={c.name} gap={1}>
            <Text color={COLOR[c.state]}>{GLYPH[c.state]}</Text>
            <Text dimColor={c.state === 'pass' || c.state === 'idle'}>{c.name}</Text>
            {c.state === 'fail' ? <Text color="#ef4444">{c.issues}</Text> : null}
          </Box>
        ))}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{row}</Box> : row
  })
}
