import { expect, test } from 'claude-code/testing'

import type { CrewRun } from '../types'
import { STRINGS, historyOf, snapshotOf } from '../hooks/crew'

const run = (over: Partial<CrewRun>): CrewRun => ({
  id: 'x',
  type: 'haiku-scout',
  description: 'search',
  model: 'claude-haiku-5-5',
  status: 'done',
  startedAt: 0,
  tools: 1,
  ...over,
})

const text = (lines: ReturnType<typeof snapshotOf>) => lines.map(l => l.map(p => p.text).join('')).join('\n')

test('a slot shows the run that ended last, not the one started last', () => {
  const list = [
    run({ id: 'early', startedAt: 0, endedAt: 9000, tokens: 9000 }),
    run({ id: 'late', startedAt: 1000, endedAt: 3000, tokens: 3000 }),
  ]
  const shown = text(snapshotOf(list, ['haiku-scout'], 10_000, 0, 80, 0, STRINGS.en))
  expect(shown).toContain('9.0k tok')
  expect(shown).not.toContain('3.0k tok')
})

test('with no room the history stays empty instead of showing the whole list', () => {
  const list = Array.from({ length: 30 }, (_, i) => run({ id: String(i), endedAt: i }))
  expect(historyOf(list, 100, 0)).toHaveLength(0)
  expect(historyOf(list, 100, 5)).toHaveLength(5)
})

test('residents stand heavy to light, whatever order they were offered in', () => {
  const shown = text(snapshotOf([], ['haiku-scout', 'reviewer', 'fable-heavy', 'opus-mid'], 0, 0, 80, 0, STRINGS.en))
  const at = (name: string) => shown.indexOf(name)
  expect(at('fable-heavy')).toBeLessThan(at('opus-mid'))
  expect(at('opus-mid')).toBeLessThan(at('haiku-scout'))
  expect(at('haiku-scout')).toBeLessThan(at('reviewer'))
})

test('at most eight residents stand in the pane', () => {
  const many = Array.from({ length: 12 }, (_, i) => `agent-${String(i).padStart(2, '0')}`)
  const shown = text(snapshotOf([], many, 0, 0, 200, 0, STRINGS.en))
  expect(shown).toContain('agent-07')
  expect(shown).not.toContain('agent-08')
})
