# claude-mods

A small collection of Claude Code mods.

## Install

```
/plugin install <mod> --marketplace Arkboi-GG/claude-mods
```

The bars stack above the prompt, so you can install any combination.

## Mods

- **task-progress**: the band above the prompt. While Claude works on a multi-step task it shows one block per step: the running step fills as "In Progress", finished steps turn green "Completed", and a turn that stops with steps still open turns amber "Paused". When Claude is idle it shows usage rings (context, 5-hour and 7-day limits) with a Compact button. It reads the task list Claude keeps while working, so it appears for multi-step tasks.
  If you also use the `skins` mod, run `/skin band off` once so its own usage band doesn't show twice.
- **repo-status**: branch, ahead/behind, changed-file count and the open PR's check state (needs `git`; `gh` is optional).
- **stack-health**: status dots for your Docker Compose services and any local ports you list (`web=5173,api=3000`).
- **preflight**: a live pre-commit checklist. After Claude edits files it re-runs your typecheck/lint (auto-detected, or set `checks`) and shows pass/fail with an error count.
- **env-guard**: a green `LOCAL` badge that turns red `PROD` when a tool call matches your production patterns, and toasts when it happens.
- **agent-crabs**: a pixel-art crab for every running subagent, dressed for its role (beret, hard hat, postman cap and more), with the agent's name, what it is working on and a timer. Finished crabs cheer and leave after a few seconds; failed ones turn grey. Name an agent by starting the Agent call's description with `Name: `, e.g. `Olivia: rewrite welcome email`; map names to outfits with the `outfits` option.
