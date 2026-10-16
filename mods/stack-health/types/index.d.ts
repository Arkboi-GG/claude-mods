export type Dot = { name: string; state: 'up' | 'down' | 'wait'; detail: string }

declare module 'claude-code' {
  interface PluginState {
    'stack-health': { dots: Dot[] }
  }
}
