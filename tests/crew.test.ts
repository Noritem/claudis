import { expect, mock, test } from 'claude-code/testing'

const SPAWN = {
  tool_use_id: 'tu1',
  prompt: 'Find every call of login()',
  description: 'find login()',
  subagentType: 'haiku-scout',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const

const PANE_PROPS = {
  title: 'Claudis',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const ENGINE = { plugin: 'engine', tier: 'core' } as const

const USAGE = {
  model: 'claude-haiku-5-5',
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 850,
}

const DONE = {
  answer: 'three places',
  durationMs: 1200,
  isAborted: false,
  turnId: 't1',
  agentId: 'a1',
  reason: 'answer',
  usage: USAGE,
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a subagent works, then is done with its tokens`, async ($, on) => {
    mock.clock(on, { now: 1000 })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))

    await $.agent.spawn(SPAWN)

    const pane = await $.ui.mount({ plugin: 'claudis', surface, component: 'Pane', requestId: 'claudis', props: PANE_PROPS })
    expect(await pane.findAll({ type: 'Text', text: 'thinking' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'find login()' })).toHaveLength(1)

    await $.turn.complete(DONE)

    // The state write redraws the pane without mounting it again.
    expect(await pane.findAll({ type: 'Text', text: '✓ done' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'thinking' })).toHaveLength(0)
    // Cache reads are kept apart: 100 in + 50 out, under the figure and in the history.
    expect(await pane.findAll({ type: 'Text', text: '150 tok · 0s' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'find login() · 0s · 150 tok' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: '150 tokens in subagents (+850 cache reads)' })).toHaveLength(1)
  })
}

test('the pane speaks German when asked to', { options: { language: 'de' } }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  await $.agent.spawn(SPAWN)
  const pane = await $.ui.mount({ plugin: 'claudis', surface: 'terminal', component: 'Pane', requestId: 'claudis', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: 'denkt' })).toHaveLength(1)

  await $.turn.complete(DONE)
  expect(await pane.findAll({ type: 'Text', text: '✓ fertig' })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: 'Verlauf' })).toHaveLength(1)
})

test('a denied spawn does not appear in the pane', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('agent.spawn', () => ({ deny: 'no' }))

  await $.agent.spawn(SPAWN)

  const pane = await $.ui.mount({ plugin: 'claudis', surface: 'terminal', component: 'Pane', requestId: 'claudis', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: 'find login()' })).toHaveLength(0)
  expect(await pane.findAll({ type: 'Text', text: 'No agent has run yet' })).toHaveLength(1)
})

test('own agent types live in the pane asleep; built-ins and plugin agents only visit', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('agent.offer', () => ({ isOffered: true }))

  await $.agent.offer({ agent: 'reviewer', description: 'Reviews code', source: 'projectSettings', provider: ENGINE })
  await $.agent.offer({ agent: 'haiku-scout', description: 'Searches', source: 'userSettings', provider: ENGINE })
  await $.agent.offer({ agent: 'general-purpose', description: 'Does anything', source: 'built-in', provider: ENGINE })
  await $.agent.offer({ agent: 'stripe:helper', description: 'Helps', source: 'plugin', provider: ENGINE })

  const pane = await $.ui.mount({ plugin: 'claudis', surface: 'terminal', component: 'Pane', requestId: 'claudis', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: 'reviewer' })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: 'haiku-scout' })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: 'general-purpose' })).toHaveLength(0)
  expect(await pane.findAll({ type: 'Text', text: 'stripe:helper' })).toHaveLength(0)
  // Named after its family, a resident shows its model before it ever ran.
  expect(await pane.findAll({ type: 'Text', text: 'Haiku' })).toHaveLength(1)
})

test('with no own agents, one Claude sleeps in the pane', async ($, on) => {
  mock.clock(on, { now: 1000 })

  const pane = await $.ui.mount({ plugin: 'claudis', surface: 'terminal', component: 'Pane', requestId: 'claudis', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: 'z Z' })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: 'idle' })).toHaveLength(1)
})

test('the pane opens by itself on the first agent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  let opened = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })

  await $.agent.spawn(SPAWN)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' })
  expect(opened).toBe(1)
})

test('with autoOpen off the pane waits for /claudis', { options: { autoOpen: false } }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  let opened = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })

  await $.agent.spawn(SPAWN)
  expect(opened).toBe(0)
})

test('a finished agent that calls a tool again works again', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.agent.spawn(SPAWN)
  await $.turn.complete(DONE)
  const pane = await $.ui.mount({ plugin: 'claudis', surface: 'terminal', component: 'Pane', requestId: 'claudis', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: '✓ done' })).toHaveLength(1)

  await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as never)
  expect(await pane.findAll({ type: 'Text', text: '✓ done' })).toHaveLength(0)
  expect(await pane.findAll({ type: 'Text', text: 'Grep' })).toHaveLength(1)
})
