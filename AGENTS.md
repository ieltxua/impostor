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

## Product UX Priorities (Gameplay-First)
- Treat this product as mobile-first party gameplay (not a generic desktop web app). Keep per-screen cognitive load minimal and focus on one primary action at a time.
- Prioritize invite entry (`QR` / link) over manual code entry:
  - Standard home (no invite params): creating a room is primary.
  - Invite home (`?room=`): show a simple, prominent join-by-name flow first; avoid equal-weight create-room UI in that state.
  - Treat `/join/:roomCode` as canonical invite path (query-style `?room=` stays only for backward compatibility).
- Keep online/offline visibility authoritative and consistent across all clients. If one player is shown reconnecting/offline on one device, the same status must be reflected everywhere from shared room state.
- Reveal phase UX should be direct:
  - Player sees own role/word with a clear reveal interaction.
  - After reveal, player can re-open/re-check own secret as needed without navigating away.
- Discussion phase UX should be explicit and host-controlled:
  - All players see current speaker name.
  - Manual turn advance is host-only.
  - For timed rounds, all players see the timer and host can pause/resume.
- Do not add generic app chrome (extra headers/footers/nav) that competes with gameplay unless explicitly requested.
