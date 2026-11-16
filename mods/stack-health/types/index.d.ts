export type Dot = { name: string; state: 'up' | 'down' | 'wait'; detail: string }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { claim: boolean }
    'stack-health': { dots: Record<string, Dot[]>; gate: Record<string, boolean> }
  }
}
