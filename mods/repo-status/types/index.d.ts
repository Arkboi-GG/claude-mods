export type Repo = {
  branch: string
  ahead: number
  behind: number
  changed: number
  pr: string
  prLong: string
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { claim: boolean }
    'repo-status': { repo: Record<string, Repo | null>; gate: Record<string, boolean> }
  }
}
