# Codex Telemetry Evidence

Date: 2026-02-21  
Workspace: `/Users/ieltxualganaras/projects/impostor`

## Command attempts

### 1) `npm run codex:usage`
Result: failed (repo has no `package.json`).

```text
npm error code ENOENT
npm error syscall open
npm error path /Users/ieltxualganaras/projects/impostor/package.json
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/Users/ieltxualganaras/projects/impostor/package.json'
```

### 2) `codex usage`
Result: failed in non-TTY context.

```text
Error: stdin is not a terminal
```

## Local fallback evidence
Because project telemetry scripts are not present, local Codex archived session files were used as evidence of available usage artifacts.

Executed commands:
- `find ~/.codex/archived_sessions -maxdepth 1 -type f -name 'rollout-*.jsonl' | wc -l`
- `find ~/.codex/archived_sessions -maxdepth 1 -type f -name 'rollout-2026-02-*.jsonl' | wc -l`
- `ls -1t ~/.codex/archived_sessions/rollout-*.jsonl | head -n 10`
- `python3` parse of latest `rollout-*.jsonl` for `turn_context` model/effort and latest `token_count` totals

Observed:
- Total archived rollout sessions: `164`
- February 2026 archived rollout sessions: `149`
- Recent files include:
  - `/Users/ieltxualganaras/.codex/archived_sessions/rollout-2026-02-20T09-16-35-019c7afa-fe0b-7251-bd7e-5fdaa6ad066b.jsonl`
  - `/Users/ieltxualganaras/.codex/archived_sessions/rollout-2026-02-20T09-00-59-019c7aec-b662-70c2-8bfe-579b7e4fade2.jsonl`
  - `/Users/ieltxualganaras/.codex/archived_sessions/rollout-2026-02-20T09-16-36-019c7afb-0474-7322-aa68-c2d3f931e550.jsonl`

Model/effort/token snapshot (latest archived rollout session):
- Source file: `/Users/ieltxualganaras/.codex/archived_sessions/rollout-2026-02-20T09-16-36-019c7afb-0474-7322-aa68-c2d3f931e550.jsonl`
- Model: `gpt-5.2-codex`
- Reasoning effort: `medium`
- Total input tokens: `453126`
- Cached input tokens: `429824`
- Output tokens: `3636`
- Reasoning output tokens: `832`
- Total tokens: `456762`

## Gap and next action
Gap:
- This repo currently lacks a project-local telemetry command.

Recommended next action:
- Add a script (for example, `scripts/codex_usage_report.sh`) and wire `npm run codex:usage` once this repo has a Node workspace.
