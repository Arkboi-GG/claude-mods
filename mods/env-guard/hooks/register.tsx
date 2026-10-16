import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Touch } from '../types'

const touchAtom = atom({ plugin: 'env-guard', key: 'touch' } as const, null as Touch)

const READ_ONLY = new Set(['Read', 'Glob', 'Grep'])

export const register: Register = (on, options) => {
  const holdMs = Math.max(1, Number(options.holdMinutes ?? 10)) * 60000
  const patterns: RegExp[] = []
  for (const p of String(options.patterns ?? 'prod,production').split(',')) {
    const s = p.trim()
    if (!s) continue
    try {
      patterns.push(new RegExp(s, 'i'))
    } catch {
      // an invalid pattern is skipped
    }
  }

  const hitOf = (e: unknown): string | null => {
    const text = JSON.stringify(e)
    for (const re of patterns) if (re.test(text)) return re.source
    return null
  }

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const hit = READ_ONLY.has(tool) ? null : hitOf(e)
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

    const { Box, Text } = $.ui.resolve(e)
    const row = (
      <Box paddingX={1} gap={1}>
        <Text color={isRed ? '#ef4444' : '#22c55e'} bold>
          {isRed ? '▲ PROD' : '● LOCAL'}
        </Text>
        {isRed && touch ? <Text dimColor>{touch.tool} matched "{touch.hit}"</Text> : null}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{row}</Box> : row
  })
}
