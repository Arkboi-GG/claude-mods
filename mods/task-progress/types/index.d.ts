export type Step = { content: string; status: 'pending' | 'in_progress' | 'completed'; startedAt?: number }

export type Usage = { context: number | null; limits: Array<{ label: string; percent: number; resetsAt?: number }> }

declare module 'claude-code' {
  interface PluginState {
    'repo-status': { repo: Record<string, { branch: string; ahead: number; behind: number; changed: number; pr: string; prLong: string } | null>; gate: Record<string, boolean> }
    'stack-health': { dots: Record<string, Array<{ name: string; state: 'up' | 'down' | 'wait'; detail: string }>>; gate: Record<string, boolean> }
    preflight: { checks: Record<string, Array<{ name: string; state: 'idle' | 'running' | 'pass' | 'fail'; issues: number; at: number }>>; gate: Record<string, boolean> }
    'env-guard': { touch: Record<string, { at: number; tool: string; hit: string; until: number } | null>; gate: Record<string, boolean> }
    'task-progress': { claim: boolean; steps: Record<string, Step[]>; usage: Record<string, Usage>; stoppedAt: Record<string, number>; tick: number }
  }
}
