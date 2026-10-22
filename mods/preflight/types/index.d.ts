export type Check = { name: string; state: 'idle' | 'running' | 'pass' | 'fail'; issues: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    preflight: { checks: Check[]; gate: boolean }
  }
}
