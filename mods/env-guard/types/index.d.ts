export type Touch = { at: number; tool: string; hit: string } | null

declare module 'claude-code' {
  interface PluginState {
    'env-guard': { touch: Touch }
  }
}
