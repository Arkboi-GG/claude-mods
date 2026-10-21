export type Stage = 'wake' | 'analyze' | 'cook' | 'wrap'

export type Crab = {
  stage?: Stage
  id: string
  name: string
  outfit: string
  task: string
  startedAt: number
  endedAt?: number
  state: 'running' | 'done' | 'failed'
}

declare module 'claude-code' {
  interface PluginState {
    'agent-crabs': { crabs: Record<string, Crab>; tick: number }
  }
}
