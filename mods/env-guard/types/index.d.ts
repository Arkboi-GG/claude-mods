export type Touch = { at: number; tool: string; hit: string; until: number } | null

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { claim: boolean }
    'env-guard': { touch: Record<string, Touch>; gate: Record<string, boolean> }
  }
}
