export type Dot = { name: string; state: 'up' | 'down' | 'wait' }

declare module 'claude-code' {
  interface PluginState {
    'stack-health': { dots: Dot[] }
  }
}
