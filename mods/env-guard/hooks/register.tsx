import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Touch } from '../types'

const touchAtom = atom({ plugin: 'env-guard', key: 'touch' } as const, null as Touch)

const WIDE = 110

const gateAtom = atom({ plugin: 'env-guard', key: 'gate' } as const, false)

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

  on('session.start', async ($, e, next) => {
    await checkGate($, githubOnly)
    $.clock.every(15000, () => checkGate($, githubOnly))
    return next(e)
  })

  const holdMs = Math.max(1, Number(options.holdMinutes ?? 10)) * 60000
  const patterns: RegExp[] = []
  for (const p of String(options.patterns ?? '\\bprod\\b,\\bproduction\\b').split(',')) {
    const s = p.trim()
    if (!s) continue
    try {
      patterns.push(new RegExp(s, 'i'))
    } catch {
      // an invalid pattern is skipped
    }
  }

  // What a call is judged on: the command, URL or arguments it acts with, never
  // the text of a file it edits or reads, and not a commit message or heredoc body.
  const subject = (e: Record<string, unknown>): string => {
    const tool = String(e.tool)
    if (tool === 'Bash') {
      return String(e.command ?? '')
        .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, '')
        .replace(/(-m|--message|--body|-b|--title|-t)\s+("[^"]*"|'[^']*')/g, '')
    }
    if (tool === 'WebFetch') return String(e.url ?? '')
    if (tool.startsWith('mcp__')) {
      const { tool: _t, tool_use_id: _i, ...args } = e
      return `${tool} ${JSON.stringify(args)}`
    }
    return ''
  }

  const hitOf = (e: Record<string, unknown>): string | null => {
    const text = subject(e)
    if (!text) return null
    for (const re of patterns) if (re.test(text)) return re.source
    return null
  }

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const hit = hitOf(e as Record<string, unknown>)
    if (hit) {
      const at = await $.clock.now()
      await update($, touchAtom, () => ({ at, tool, hit }))
      $.ui.toast(`Production touched by ${tool} (matched "${hit}")`)
      // clear the red badge once the hold time has passed
      $.clock.after(holdMs + 1000, () => update($, touchAtom, t => (t && t.at === at ? { ...t } : t)))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const touch = await read($, touchAtom)
    const now = await $.clock.now()
    const isRed = touch !== null && now - touch.at < holdMs
    // The LOCAL badge only shows in a GitHub repository; a red PROD warning shows anywhere.
    if (!isRed && !(await read($, gateAtom))) return below

    const { Box, Text } = $.ui.resolve(e)
    const zone = (
      <Box gap={1}>
        <Text color={isRed ? '#ef4444' : '#22c55e'} bold>
          {isRed ? '▲ PROD' : '● LOCAL'}
        </Text>
        {isRed && touch ? <Text dimColor>{touch.tool} matched "{touch.hit}"</Text> : null}
      </Box>
    )
    return addZone(below, zone, 9)
  })
}
