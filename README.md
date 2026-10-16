# claude-mods

A small collection of Claude Code mods.

## Install

```
/plugin install <mod> --marketplace Arkboi-GG/claude-mods
```

The bars stack above the prompt, so you can install any combination.

## Mods

- **task-progress**: a rounded, gradient progress bar above the prompt showing how far Claude is through the current task (`Tasks 2/5`, percentage, current step). It reads the task list Claude keeps while working, so it appears for multi-step tasks.
- **repo-status**: branch, ahead/behind, changed-file count and the open PR's check state (needs `git`; `gh` is optional).
- **stack-health**: status dots for your Docker Compose services and any local ports you list (`web=5173,api=3000`).
- **preflight**: a live pre-commit checklist. After Claude edits files it re-runs your typecheck/lint (auto-detected, or set `checks`) and shows pass/fail with an error count.
- **env-guard**: a green `LOCAL` badge that turns red `PROD` when a tool call matches your production patterns, and toasts when it happens.
