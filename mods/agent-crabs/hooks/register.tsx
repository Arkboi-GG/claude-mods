import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Crab } from '../types'

const crabsAtom = atom({ plugin: 'agent-crabs', key: 'crabs' } as const, {} as Record<string, Crab>)
const tickAtom = atom({ plugin: 'agent-crabs', key: 'tick' } as const, 0)

const ORANGE = '#fb923c'

// Pixel art. The crab is a 16 x 11 grid; every letter is a colour in PALETTE, a dot is empty.
const W = 16
const H = 11
const SCALE = 2

const PALETTE: Record<string, string> = {
  o: '#e2724a', // body
  d: '#b4512f', // legs
  c: '#f4977a', // claws
  w: '#ffffff',
  k: '#1a1a1a',
  R: '#dc2626',
  B: '#3b82f6',
  b: '#3b82f6',
  g: '#9ca3af',
  N: '#1e3a8a',
  K: '#1f2937',
  Y: '#facc15',
  y: '#facc15',
  h: '#94a3b8',
  l: '#67e8f9',
  T: '#b08968',
}

// The grey a failed crab turns.
const GREY: Record<string, string> = { o: '#6b7280', d: '#4b5563', c: '#9ca3af' }

type Rows = Record<number, string>

const BODY: Rows = {
  4: '..oooooooooooo..',
  5: '.oowkooooowkooo.',
  6: '.oowwooooowwooo.',
  7: '.oooooooooooooo.',
  8: '..oooooooooooo..',
}

const LEGS: Rows[] = [
  { 9: '..d.d.d..d.d.d..', 10: '.d.d.d....d.d.d.' },
  { 9: '.d.d.d....d.d.d.', 10: '..d.d.d..d.d.d..' },
]

const CLAW_LEFT_UP: Rows = { 1: 'c.c.............', 2: 'ccc.............', 3: '.c..............', 4: '.c..............' }
const CLAW_RIGHT_UP: Rows = { 1: '.............c.c', 2: '.............ccc', 3: '..............c.', 4: '..............c.' }
const CLAW_LEFT_DOWN: Rows = { 5: 'c.c.............', 6: 'ccc.............', 7: '.c..............' }
const CLAW_RIGHT_DOWN: Rows = { 5: '.............c.c', 6: '.............ccc', 7: '..............c.' }

const OUTFITS: Record<string, Rows> = {
  plain: {},
  beret: { 1: '........R.......', 2: '.....RRRRRR.....', 3: '....RRRRRRRR....' },
  hoodie: { 2: '.....BBBBBB.....', 3: '....BBBBBBBB....', 7: '.....gggggg.....', 8: '.....gggggg.....' },
  postman: { 2: '.....NNNNNN.....', 3: '...NNNNNNNNNN...', 7: '......wwww......', 8: '......wddw......' },
  grad: { 2: '..KKKKKKKKKKKK..', 3: '.....KKKKKK.Y...', 4: '............Y...' },
  headset: { 2: '.....hhhhhh.....', 3: '....h......h....', 4: '...h........h...', 5: '...h........h...' },
  magnifier: {
    2: '......TTTT......',
    3: '.....TTTTTT.....',
    6: '.......ll.......',
    7: '......l..l......',
    8: '......l..l......',
    9: '.......ll.......',
    10: '..........T.....',
  },
  megaphone: { 7: '...........yy...', 8: '...........yyy..', 9: '............yyy.' },
  hardhat: { 1: '.......YY.......', 2: '.....YYYYYY.....', 3: '...YYYYYYYYYY...', 7: '..........bb....', 8: '..........bw....' },
  explorer: { 1: '......TTTT......', 2: '.....TTTTTT.....', 3: '...TTTTTTTTTT...' },
}

// Agent name (lowercase) or agent type to outfit. Anything else gets a plain crab.
const DEFAULT_OUTFITS: Record<string, string> = {
  olivia: 'beret',
  jack: 'hoodie',
  achilles: 'postman',
  dexter: 'grad',
  erica: 'headset',
  paul: 'magnifier',
  joanne: 'megaphone',
  simon: 'hardhat',
  explore: 'explorer',
  plan: 'hardhat',
}

// One crab as an SVG: claws alternate with the frame, both raised when it has finished.
function crabSvg(outfit: string, frame: number, state: Crab['state']): string {
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill('.'))
  const paint = (rows: Rows) => {
    for (const [y, row] of Object.entries(rows)) {
      for (let x = 0; x < W; x++) if (row[x] && row[x] !== '.') grid[Number(y)][x] = row[x]
    }
  }
  paint(BODY)
  paint(LEGS[frame % 2])
  if (state === 'done') {
    paint(CLAW_LEFT_UP)
    paint(CLAW_RIGHT_UP)
  } else if (frame % 2 === 0) {
    paint(CLAW_LEFT_UP)
    paint(CLAW_RIGHT_DOWN)
  } else {
    paint(CLAW_LEFT_DOWN)
    paint(CLAW_RIGHT_UP)
  }
  paint(OUTFITS[outfit] ?? OUTFITS.plain)

  const colour = (ch: string) => (state === 'failed' && GREY[ch] ? GREY[ch] : PALETTE[ch])
  let rects = ''
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      const ch = grid[y][x]
      if (ch === '.' || !PALETTE[ch]) {
        x++
        continue
      }
      let run = 1
      while (x + run < W && grid[y][x + run] === ch) run++
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colour(ch)}"/>`
      x += run
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${rects}</svg>`
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 'Olivia: rewrite welcome email' -> name Olivia, task 'rewrite welcome email'.
// The brain's router puts the agent's name in front of every named dispatch.
const NAMED = /^([A-Za-z][\w.-]{0,24}):\s+(.+)$/

export const register: Register = (on, options) => {
  const lingerMs = Math.max(1, Number(options.lingerSeconds ?? 6)) * 1000
  const maxShown = Math.max(1, Number(options.maxShown ?? 4))

  const outfits: Record<string, string> = { ...DEFAULT_OUTFITS }
  for (const pair of String(options.outfits ?? '').split(',')) {
    const [name, outfit] = pair.split('=').map(s => s.trim())
    if (name && outfit) outfits[name.toLowerCase()] = outfit
  }

  const describe = (a: { id: string; description: string; type: string }) => {
    const m = a.type === 'general-purpose' ? NAMED.exec(a.description) : null
    const name = m ? m[1] : a.type === 'general-purpose' ? '' : a.type
    const task = m ? m[2] : a.description
    const outfit = outfits[name.toLowerCase()] ?? outfits[a.type.toLowerCase()] ?? 'plain'
    return { id: a.id, name, outfit, task }
  }

  // Crabs that have already left. The engine keeps a finished agent in its list for a while,
  // so without this a crab would come back each time it was cleared away.
  const gone = new Set<string>()

  on('session.start', async ($, e, next) => {
    const poll = async () => {
      try {
        const list = await $.agent.list()
        const now = await $.clock.now()
        const prev = await read($, crabsAtom)
        const out: Record<string, Crab> = {}
        const seen = new Set<string>()
        for (const a of list) {
          if (a.type === 'teammate') continue
          seen.add(a.id)
          const state: Crab['state'] =
            a.status === 'completed' ? 'done' : a.status === 'failed' || a.status === 'killed' ? 'failed' : 'running'
          if (gone.has(a.id)) {
            // Only an agent that runs again (resumed) brings its crab back.
            if (state !== 'running') continue
            gone.delete(a.id)
          }
          const old = prev[a.id]
          const base: Crab = old ?? { ...describe(a), startedAt: now, state }
          out[a.id] = { ...base, state, endedAt: state === 'running' ? undefined : (old?.endedAt ?? now) }
        }
        // An agent the engine has dropped from the list has finished.
        for (const [id, c] of Object.entries(prev)) {
          if (!seen.has(id)) out[id] = c.state === 'running' ? { ...c, state: 'done', endedAt: now } : c
        }
        for (const [id, c] of Object.entries(out)) {
          if (c.endedAt !== undefined && now - c.endedAt > (c.state === 'failed' ? lingerMs * 3 : lingerMs)) {
            delete out[id]
            gone.add(id)
          }
        }
        await update($, crabsAtom, p => (JSON.stringify(p) === JSON.stringify(out) ? p : out))
        // Once a second while there are crabs, so claws move and the timers count.
        if (Object.keys(out).length > 0) await update($, tickAtom, n => n + 1)
      } catch {
        // the agent list is not ready: keep what is on screen
      }
    }
    $.clock.every(1000, poll)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const crabs = Object.values(await read($, crabsAtom)).sort((a, b) => a.startedAt - b.startedAt)
    const tick = await read($, tickAtom)
    if (crabs.length === 0) return below

    const now = await $.clock.now()
    const { Box, Text, Svg } = $.ui.resolve(e)
    const shown = crabs.slice(-maxShown)
    const hidden = crabs.length - shown.length

    const rows = shown.map(c => {
      const label = c.name || 'agent'
      const stamp = mmss((c.endedAt ?? now) - c.startedAt)
      const status =
        c.state === 'running' ? <Text dimColor>{stamp}</Text> : c.state === 'done' ? <Text color="#22c55e">✓ {stamp}</Text> : <Text color="#ef4444">✗ failed</Text>
      return (
        <Box paddingX={1} alignItems="center" gap={1}>
          <Box flexShrink={0}>
            <Svg source={crabSvg(c.outfit, tick, c.state)} alt={`${label} crab`} />
          </Box>
          <Box flexShrink={0}>
            <Text bold color={ORANGE}>{label}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text dimColor wrap="truncate-end">{c.task}</Text>
          </Box>
          <Box flexShrink={0}>{status}</Box>
        </Box>
      )
    })

    const zone = (
      <Box key="agent-crabs" flexDirection="column">
        {rows}
        {hidden > 0 ? (
          <Box paddingX={1}>
            <Text dimColor>+{hidden} more</Text>
          </Box>
        ) : null}
      </Box>
    )
    return below ? <Box flexDirection="column">{zone}{below}</Box> : zone
  })
}
