# TASKS - Impostor Web MVP

Last updated: 2026-02-21

## Phase 0 - Harness + Governance
- [x] Create markdown PRD from source PDF.
- [x] Create harness docs (`TASKS`, `DECISIONS`, `CHANGELOG`).
- [x] Bootstrap project subagent config and role prompts.
- [x] Add project `AGENTS.md` with mandatory routing policy.
- [x] Capture telemetry command evidence.

## Phase 1 - Shared Contracts
- [x] Implement `shared/types/events.ts` from PRD section 8.
- [x] Implement `shared/types/room.ts` and `shared/types/words.ts`.
- [x] Add runtime validation for host and vote payloads.

## Phase 2 - Server State Machine
- [x] Implement room store (in-memory MVP).
- [x] Implement lifecycle transitions (`LOBBY -> END`).
- [x] Implement role assignment and secret delivery.
- [x] Implement vote tally and random tie-break.
- [x] Implement victory evaluation presets (`SIMPLE`, `CLASSIC_GUESS`).
- [x] Implement reconnect logic by `playerToken`.

## Phase 3 - Client UX
- [x] Build Home, Lobby, Game, Public routes.
- [x] Implement LIVE anti-spoiler secret card behavior.
- [x] Implement turn banner + timer + vote panel.
- [x] Implement host controls (configure/start/close/reset).

## Phase 4 - Validation
- [x] Unit tests for role assignment, transitions, tally, victory logic.
- [x] Integration test for 6-player full flow.
- [x] Integration test for reconnect mid-round.
- [x] Verify `/public` never receives secret payloads.
- [x] Add socket-level auth/session regression tests (stale socket, host-key checks, same-room rejoin).
- [x] Add scripted pilot simulation runner for multi-match E2E reliability checks.
- [x] Add Playwright smoke test with selector contract stable across redesigns.

## Phase 5 - Playtest and Ops
- [x] Define local runbook and tunnel command examples.
- [x] Add mode-specific pilot ops scripts (`pilot-up`, `pilot-down`, `pilot-validate`) and document usage.
- [ ] Run a live 6-10 player pilot session.
- [ ] Record issues and promote fixes to changelog + decisions.
