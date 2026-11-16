export type Check = { name: string; state: 'idle' | 'running' | 'pass' | 'fail'; issues: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { claim: boolean }
    preflight: { checks: Record<string, Check[]>; gate: Record<string, boolean> }
  }
}
