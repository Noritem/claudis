// What the pane shows, without the engine: the same views draw the pane and the snapshot.
import type { CrewRun, CrewStatus } from '../types'

export const SLOT = 16 // columns per Claude, one of them the gap to its neighbour
export const SLOT_TEXT = SLOT - 1
export const NAP_MS = 120_000 // how long a finished Claude shows its result before it falls asleep again
const MAX_RESIDENTS = 8 // own agent types that always stand in the pane; more appear only while they work

export type Lang = 'en' | 'de'

export const STRINGS = {
  en: {
    thinking: 'thinking',
    done: '✓ done',
    stopped: '■ stopped',
    failed: '✗ failed',
    idle: 'idle',
    last: 'last',
    tool: 'tool',
    tools: 'tools',
    summary: (running: number, done: number, tokens: string) =>
      `${running} working · ${done} done · ${tokens} tokens in subagents`,
    cached: (tokens: string) => ` (+${tokens} cache reads)`,
    history: 'History',
    emptyHint: 'No agent has run yet. Try “have an Explore agent find where X is used”.',
    command: 'Show your subagents as little Claudes in a pane',
    opened: 'Claudis pane opened.',
  },
  de: {
    thinking: 'denkt',
    done: '✓ fertig',
    stopped: '■ gestoppt',
    failed: '✗ Fehler',
    idle: 'bereit',
    last: 'zuletzt',
    tool: 'Tool',
    tools: 'Tools',
    summary: (running: number, done: number, tokens: string) =>
      `${running} arbeiten · ${done} fertig · ${tokens} Tokens in Subagents`,
    cached: (tokens: string) => ` (+${tokens} aus dem Cache)`,
    history: 'Verlauf',
    emptyHint: 'Noch kein Agent gelaufen. Probier z. B. „lass einen Explore-Agent suchen, wo X verwendet wird“.',
    command: 'Zeigt deine Agents als kleine Claudes in einem Pane',
    opened: 'Claudis-Pane geöffnet.',
  },
}

export type Strings = (typeof STRINGS)['en']

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku']
const COLORS: Record<string, string> = {
  fable: '#c084fc',
  opus: '#d97757',
  sonnet: '#60a5fa',
  haiku: '#4ade80',
}

type Pose = 'sleep' | 'workA' | 'workB' | 'done' | 'fail'

const BODY: Record<Pose, string[]> = {
  sleep: [' ▐▀███▀▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  workA: [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  workB: ['▗▐▛███▜▌▖', ' ▜█████▛ ', '  ▝▘ ▘▝  '],
  done: [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  fail: [' ▐▚███▞▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const STATUS_ICON: Record<CrewStatus, { icon: string; color: string }> = {
  running: { icon: '●', color: 'claude' },
  done: { icon: '✓', color: 'success' },
  failed: { icon: '✗', color: 'error' },
  aborted: { icon: '■', color: 'warning' },
}

// A model id ("claude-haiku-5-5") or an agent name ("haiku-scout") both name their family.
const familyOf = (text: string) => FAMILIES.find(family => text.toLowerCase().includes(family))
export const colorOf = (model: string) => COLORS[familyOf(model) ?? ''] ?? 'claude'
const modelLabel = (model: string) => {
  const family = familyOf(model)
  return family ? family.charAt(0).toUpperCase() + family.slice(1) : model
}
const shortTool = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)
const toolCount = (n: number, t: Strings) => `${n} ${n === 1 ? t.tool : t.tools}`

export const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 100_000
      ? `${Math.round(n / 1000)}k`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : String(n)

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

// The duration gives way where both do not fit under the figure; the history still has it.
const fit = (main: string, duration: string) => {
  const both = `${main} · ${duration}`
  return [...both].length <= SLOT_TEXT ? both : main
}

const isFresh = (run: CrewRun, now: number) => run.endedAt !== undefined && now - run.endedAt < NAP_MS

// Heavy to light, as the families go; names without a family last.
const familyRank = (type: string) => {
  const family = familyOf(type)
  return family === undefined ? FAMILIES.length : FAMILIES.indexOf(family)
}
const byFamily = (a: string, b: string) => familyRank(a) - familyRank(b) || a.localeCompare(b)

type Slot = { type: string; model: string; run?: CrewRun; isAwake: boolean }

// Who stands in the pane: each of the person's own agent types once (or once per running
// instance), plus any other type (Explore, general-purpose, ...) while it works or just finished.
function crewOf(list: CrewRun[], residents: string[], now: number): Slot[] {
  const home = [...new Set(residents)].sort(byFamily).slice(0, MAX_RESIDENTS)
  const slots: Slot[] = []
  for (const type of home) {
    const mine = list.filter(run => run.type === type)
    const running = mine.filter(run => run.status === 'running')
    if (running.length > 0) {
      for (const run of running) slots.push({ type, model: run.model, run, isAwake: true })
      continue
    }
    // The run that ended last, not the one started last: parallel runs end in any order.
    const last = mine.reduce<CrewRun | undefined>(
      (best, run) => (best === undefined || (run.endedAt ?? 0) >= (best.endedAt ?? 0) ? run : best),
      undefined,
    )
    slots.push({
      type,
      model: last?.model ?? familyOf(type) ?? '',
      run: last,
      isAwake: last !== undefined && isFresh(last, now),
    })
  }
  const homeTypes = new Set(home)
  for (const run of list) {
    if (homeTypes.has(run.type)) continue
    if (run.status === 'running' || isFresh(run, now)) slots.push({ type: run.type, model: run.model, run, isAwake: true })
  }
  // Nobody home and nobody working: one Claude sleeps there, so the pane is never empty.
  if (slots.length === 0) slots.push({ type: 'claude', model: '', isAwake: false })
  return slots
}

function poseOf(slot: Slot, tick: number): Pose {
  if (!slot.isAwake || slot.run === undefined) return 'sleep'
  if (slot.run.status === 'running') return tick % 2 === 0 ? 'workA' : 'workB'
  return slot.run.status === 'done' ? 'done' : 'fail'
}

export type Line = { text: string; color: string; isDim: boolean; isBold: boolean }

export type SlotView = { color: string; isAsleep: boolean; lines: Line[] }

function slotView(slot: Slot, tick: number, now: number, t: Strings): SlotView {
  const pose = poseOf(slot, tick)
  const color = colorOf(slot.model)
  const isAsleep = pose === 'sleep'
  const run = slot.run

  const bubble =
    !slot.isAwake || run === undefined
      ? { text: 'z Z', color: 'subtle', isDim: true }
      : run.status === 'running'
        ? { text: `${SPIN[tick % SPIN.length]} ${run.lastTool ? shortTool(run.lastTool) : t.thinking}`, color, isDim: false }
        : run.status === 'done'
          ? { text: t.done, color: 'success', isDim: false }
          : run.status === 'aborted'
            ? { text: t.stopped, color: 'warning', isDim: false }
            : { text: t.failed, color: 'error', isDim: false }

  let detail = t.idle
  if (run !== undefined && run.status === 'running') detail = fit(toolCount(run.tools, t), fmtDuration(now - run.startedAt))
  else if (run !== undefined) {
    const spent = run.tokens !== undefined ? `${fmtTokens(run.tokens)} tok` : toolCount(run.tools, t)
    detail = slot.isAwake ? fit(spent, fmtDuration((run.endedAt ?? now) - run.startedAt)) : `${t.last} ${spent}`
  }

  return {
    color,
    isAsleep,
    lines: [
      { text: bubble.text, color: bubble.color, isDim: bubble.isDim, isBold: false },
      ...BODY[pose].map(text => ({ text, color, isDim: isAsleep, isBold: false })),
      { text: slot.type, color, isDim: false, isBold: !isAsleep },
      { text: modelLabel(slot.model), color: 'text', isDim: true, isBold: false },
      { text: detail, color: 'text', isDim: true, isBold: false },
    ],
  }
}

export const SLOT_ROWS = 7 // rows per Claude: bubble, 3 body, name, model, detail

export function crewRows(
  list: CrewRun[],
  residents: string[],
  now: number,
  tick: number,
  columns: number,
  t: Strings,
): SlotView[][] {
  const views = crewOf(list, residents, now).map(slot => slotView(slot, tick, now, t))
  const perRow = Math.max(1, Math.floor(columns / SLOT))
  const rows: SlotView[][] = []
  for (let i = 0; i < views.length; i += perRow) rows.push(views.slice(i, i + perRow))
  return rows
}

export function summaryOf(list: CrewRun[], t: Strings): string {
  const running = list.filter(run => run.status === 'running').length
  const spent = list.reduce((sum, run) => sum + (run.tokens ?? 0), 0)
  const cached = list.reduce((sum, run) => sum + (run.cached ?? 0), 0)
  return t.summary(running, list.length - running, fmtTokens(spent)) + (cached > 0 ? t.cached(fmtTokens(cached)) : '')
}

export type HistoryView = { icon: string; iconColor: string; name: string; nameColor: string; detail: string }

export function historyOf(list: CrewRun[], now: number, room: number): HistoryView[] {
  if (room <= 0) return [] // slice(-0) would be the whole list
  return list
    .slice(-room)
    .reverse()
    .map(run => {
      const mark = STATUS_ICON[run.status]
      const took = fmtDuration((run.endedAt ?? now) - run.startedAt)
      const spent = run.tokens !== undefined ? ` · ${fmtTokens(run.tokens)} tok` : ''
      return {
        icon: mark.icon,
        iconColor: mark.color,
        name: run.type,
        nameColor: colorOf(run.model),
        detail: `${run.description} · ${took}${spent}`,
      }
    })
}

// The pane as text lines of colored pieces, as the terminal draws it (for snapshots and images).
export type Piece = { text: string; color: string; isDim?: boolean; isBold?: boolean }

const center = (text: string, width: number) => {
  const chars = [...text]
  if (chars.length > width) return chars.slice(0, width - 1).join('') + '…'
  const left = Math.floor((width - chars.length) / 2)
  return ' '.repeat(left) + text + ' '.repeat(width - chars.length - left)
}

const wrapWords = (text: string, width: number) => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && [...line].length + 1 + [...word].length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

export function snapshotOf(
  list: CrewRun[],
  residents: string[],
  now: number,
  tick: number,
  columns: number,
  room: number,
  t: Strings,
): Piece[][] {
  const out: Piece[][] = [[{ text: summaryOf(list, t), color: 'text', isDim: true }]]
  for (const row of crewRows(list, residents, now, tick, columns, t)) {
    out.push([])
    for (let i = 0; i < SLOT_ROWS; i++) {
      out.push(
        row.map(view => {
          const line = view.lines[i] ?? { text: '', color: 'text', isDim: false, isBold: false }
          return { text: center(line.text, SLOT_TEXT) + ' ', color: line.color, isDim: line.isDim, isBold: line.isBold }
        }),
      )
    }
  }
  out.push([])
  const history = historyOf(list, now, room)
  if (history.length === 0) {
    for (const text of wrapWords(t.emptyHint, columns)) out.push([{ text, color: 'text', isDim: true }])
  } else {
    out.push([{ text: t.history, color: 'text', isBold: true }])
    for (const item of history) {
      out.push([
        { text: `${item.icon} `, color: item.iconColor },
        { text: `${item.name} `, color: item.nameColor },
        { text: item.detail, color: 'text', isDim: true },
      ])
    }
  }
  return out
}
