import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CrewRun, CrewStatus } from '../types'
import { NAP_MS, SLOT, SLOT_ROWS, SLOT_TEXT, STRINGS, crewRows, historyOf, snapshotOf, summaryOf } from './crew'

const PANE = 'mini-claudes'
const TITLE = 'Claudes'
const TICK_MS = 400
const SNAPSHOT_TOOL = 'mcp__mini-claudes__snapshot'

const runs = atom({ plugin: 'mini-claudes', key: 'runs' } as const, [] as CrewRun[])
const frame = atom({ plugin: 'mini-claudes', key: 'frame' } as const, 0)
const autoOpened = atom({ plugin: 'mini-claudes', key: 'autoOpened' } as const, false)
const residents = atom({ plugin: 'mini-claudes', key: 'residents' } as const, [] as string[])

// Agent types the person defined (user or project settings); built-ins and plugin agents only visit.
const isOwnAgent = (source: string) => source !== 'built-in' && source !== 'plugin'

const resumed = ({ endedAt: _endedAt, ...run }: CrewRun): CrewRun => ({ ...run, status: 'running' })

export const register: Register = (on, options) => {
  const t = STRINGS[options.language === 'de' ? 'de' : 'en']
  const isAutoOpen = options.autoOpen !== false
  const hasSnapshotTool = options.snapshotTool === true

  // The clock only does work while someone works or a finished Claude is about to fall asleep.
  // `wakes` keeps a tick that read the list before a spawn from putting the new run to sleep.
  let isAwake = true
  let wakes = 0
  const wake = () => {
    wakes += 1
    isAwake = true
  }
  // Agent types already written to `residents`, so an offer of a known one costs no state read.
  const known = new Set<string>()
  // The hooks below that only watch carry `.catch(($, e, next) => next(e))`: should one throw,
  // the event goes on as if it were not there.

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'claudes', description: t.command })
    if (hasSnapshotTool) {
      await $.tool.register({
        name: 'snapshot',
        description:
          'Shows the current state of the Claudes pane (subagents of this session: status, model, tools, tokens) as text lines with colors.',
        inputSchema: {
          type: 'object',
          properties: {
            columns: { type: 'number', description: 'Pane width in characters (default 80)' },
            file: { type: 'string', description: 'Optional: absolute path to write the snapshot to as JSON' },
          },
        },
      })
    }

    let ticks = 0
    $.clock.every(TICK_MS, () => {
      if (!isAwake) return
      ticks += 1
      const seen = wakes
      void (async () => {
        const list = await read($, runs)
        const now = await $.clock.now()
        const isBusy = list.some(run => run.status === 'running')
        const isSettling = list.some(run => run.endedAt !== undefined && now - run.endedAt < NAP_MS + 2 * TICK_MS)

        // Should an end have been missed (an abort, say), the engine's own list sets it right.
        if (isBusy && ticks % 5 === 0) {
          const live = new Map((await $.agent.list()).map(agent => [agent.id, agent.status]))
          await update($, runs, all =>
            all.map((run): CrewRun => {
              if (run.status !== 'running') return run
              const status = live.get(run.id)
              if (status === 'completed') return { ...run, status: 'done', endedAt: now }
              if (status === 'failed') return { ...run, status: 'failed', endedAt: now }
              if (status === 'killed') return { ...run, status: 'aborted', endedAt: now }
              return run
            }),
          )
        }
        if (isBusy || isSettling) {
          if (isBusy || ticks % 10 === 0) await update($, frame, n => (n + 1) % 1_000_000)
          return
        }
        // Everyone is asleep now: draw that once more, then rest until the next spawn.
        if (wakes === seen) isAwake = false
        await update($, frame, n => (n + 1) % 1_000_000)
      })().catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'claudes' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: t.opened }
  })

  on('agent.offer', async ($, e, next) => {
    const offer = await next(e)
    if (offer.isOffered && isOwnAgent(e.source) && !known.has(e.agent)) {
      known.add(e.agent)
      await update($, residents, list => (list.includes(e.agent) ? list : [...list, e.agent]))
    }
    return offer
  }).catch(($, e, next) => next(e))

  // A plugin tool's input lies on `e` itself (e.columns), not under e.input.
  on('tool.call', { tool: SNAPSHOT_TOOL }, async ($, e) => {
    const input = e as unknown as { columns?: unknown; file?: unknown }
    const columns = typeof input.columns === 'number' ? Math.max(SLOT, input.columns) : 80
    const list = await read($, runs)
    const home = await read($, residents)
    const now = await $.clock.now()
    const tick = await read($, frame)
    const lines = snapshotOf(list, home, now, tick, columns, 12, t)
    if (typeof input.file !== 'string') return { result: JSON.stringify({ columns, lines }) }

    // The file holds the raw data too, so a moment can be replayed through crew.ts.
    await $.fs.write(input.file, JSON.stringify({ columns, lines, now, tick, runs: list, residents: home }))
    return { result: `Snapshot written: ${input.file}\n${summaryOf(list, t)}` }
  }).catch(() => ({ result: 'The snapshot could not be taken.' }))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || started.agentId === undefined) return started

    const run: CrewRun = {
      id: started.agentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: await $.clock.now(),
      tools: 0,
    }
    await update($, runs, list => [...list, run].slice(-100))
    wake()

    // The first agent of the session opens the pane by itself; after that only /claudes does.
    if (isAutoOpen && !(await read($, autoOpened))) {
      await update($, autoOpened, () => true)
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const tool = String(e.tool)
      const list = await read($, runs)
      const run = list.find(item => item.id === agentId)
      if (run !== undefined) {
        // A finished agent that calls a tool again was resumed (SendMessage): it works again.
        if (run.status !== 'running') wake()
        await update($, runs, all =>
          all.map(item =>
            item.id === agentId ? { ...(item.status === 'running' ? item : resumed(item)), tools: item.tools + 1, lastTool: tool } : item,
          ),
        )
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const status: CrewStatus = e.isAborted
        ? 'aborted'
        : e.reason === 'error' || e.reason === 'refusal'
          ? 'failed'
          : 'done'
      // A turn's usage is summed over all its requests, so cache reads add up to many times the
      // context: they are counted apart from what the run actually added.
      const usage = e.usage
      const spent = usage ? usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + usage.output_tokens : 0
      const cached = usage?.cache_read_input_tokens ?? 0
      const now = await $.clock.now()
      await update($, runs, all =>
        all.map(
          (run): CrewRun =>
            run.id === agentId
              ? {
                  ...run,
                  status,
                  endedAt: now,
                  tokens: (run.tokens ?? 0) + spent,
                  cached: (run.cached ?? 0) + cached,
                  model: usage?.model ?? run.model,
                }
              : run,
        ),
      )
      wake()
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, runs)
    const home = await read($, residents)
    const tick = await read($, frame)
    const now = await $.clock.now()

    const rows = crewRows(list, home, now, tick, e.props.bodyColumns, t)
    const room = Math.min(12, Math.max(0, (e.viewport?.rows ?? 40) - 4 - rows.length * (SLOT_ROWS + 1)))
    const history = historyOf(list, now, room)

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate">
          {summaryOf(list, t)}
        </Text>
        {rows.map(row => (
          <Box flexDirection="row" marginTop={1}>
            {row.map(view => (
              <Box flexDirection="column" alignItems="center" width={SLOT_TEXT} marginRight={1}>
                {view.lines.map(line => (
                  <Text color={line.color} dimColor={line.isDim} bold={line.isBold} wrap="truncate">
                    {line.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        ))}
        {history.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {t.emptyHint}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{t.history}</Text>
            {history.map(item => (
              <Box flexDirection="row">
                <Text color={item.iconColor}>{`${item.icon} `}</Text>
                <Text color={item.nameColor}>{`${item.name} `}</Text>
                <Text dimColor wrap="truncate">
                  {item.detail}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
