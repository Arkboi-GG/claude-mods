export type Check = { name: string; state: 'idle' | 'running' | 'pass' | 'fail'; issues: number }

declare module 'claude-code' {
  interface PluginState {
    preflight: { checks: Check[] }
  }
}
