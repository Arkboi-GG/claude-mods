export type Step = { content: string; status: 'pending' | 'in_progress' | 'completed'; startedAt?: number }

export type Usage = { context: number | null; limits: Array<{ label: string; percent: number }> }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { steps: Step[]; usage: Usage; stoppedAt: number; tick: number }
  }
}
