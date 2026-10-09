export type CrewStatus = 'running' | 'done' | 'failed' | 'aborted'

/** One subagent run of this session, as the pane draws it. */
export type CrewRun = {
  id: string
  type: string
  description: string
  model: string
  status: CrewStatus
  startedAt: number
  endedAt?: number
  tools: number
  lastTool?: string
  /** Input, cache-write and output tokens: what the run actually added. */
  tokens?: number
  /** Cache reads, summed over every request of the run. Cheap, so kept apart. */
  cached?: number
}

declare module 'claude-code' {
  interface PluginState {
    'mini-claudes': {
      runs: CrewRun[]
      frame: number
      autoOpened: boolean
      /** The person's own agent types (user or project settings), seen as the engine offered them. */
      residents: string[]
    }
  }
}
