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
    'repo-status': { repo: Repo | null }
  }
}
