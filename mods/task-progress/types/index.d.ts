export type Step = { content: string; status: 'pending' | 'in_progress' | 'completed'; startedAt?: number }

export type Usage = { context: number | null; limits: Array<{ label: string; percent: number; resetsAt?: number }> }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { steps: Record<string, Step[]>; usage: Record<string, Usage>; stoppedAt: Record<string, number>; tick: number }
  }
}
