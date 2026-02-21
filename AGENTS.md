# Project Agent Protocol

This file governs `/Users/ieltxualganaras/projects/impostor` and all child paths.

## Goal Clarity First
- Restate the goal before doing non-trivial work.
- List success criteria and constraints explicitly.
- Enumerate assumptions (intent, system behavior, available context).
- Classify task context as low, medium, or high; if medium/high and context is missing, ask before proceeding.

## Claims and Grounding
- Mark every substantive claim as one of: falsifiable, assumption, or speculative.
- Prefer abstention over invention when information is missing.
- Keep outputs interpretable: include why this approach was chosen and what alternatives were considered.

## Project Subagent Pool (Mandatory)
- Use repo-local `.codex/config.toml` role mappings when present.
- Route non-trivial tasks through `explorer_fast -> implementer_balanced -> reviewer_deep` unless the scope is clearly read-only.
- Escalate reasoning effort only for high-ambiguity or high-risk decisions.
- For optimization/tuning requests, include telemetry evidence from `reports/telemetry/`.

## Harness Documents (Mandatory)
- Keep these files current for substantive work:
  - `harness/TASKS.md`
  - `harness/DECISIONS.md`
  - `harness/CHANGELOG.md`
- Record only meaningful actions and decisions; avoid noisy exploration logs.

## Review and Validation
- Before handoff, run at least one focused validation step and report residual risk.
- If a required command is unavailable, record the exact failure and recommended fallback in `reports/telemetry/`.
