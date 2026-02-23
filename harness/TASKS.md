# TASKS - Impostor Web MVP

Last updated: 2026-02-23

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
- [x] Expand shared random deck to a larger multi-category set and export reusable category list.

## Phase 2 - Server State Machine
- [x] Implement room store (in-memory MVP).
- [x] Implement lifecycle transitions (`LOBBY -> END`).
- [x] Implement role assignment and secret delivery.
- [x] Implement vote tally and random tie-break.
- [x] Implement victory evaluation presets (`SIMPLE`, `CLASSIC_GUESS`).
- [x] Implement reconnect logic by `playerToken`.
- [x] Keep room alive on temporary host disconnect with reconnect grace and stale-socket disconnect guards.
- [x] Expose player connection state in public room roster and count only active-ready players for start validation.
- [x] Reclaim disconnected lobby player slots by name (non-host/non-local) to reduce duplicate-entry reconnect friction on mobile.
- [x] Add host timer pause/resume controls for timed clue rounds with shared paused state visibility.
- [x] Support random word filtering by multiple selected categories with safe full-deck fallback.
- [x] Add heartbeat-driven presence sync with stale-player sweep so connected/reconnecting state is consistent across mobile clients.

## Phase 3 - Client UX
- [x] Build Home, Lobby, Game, Public routes.
- [x] Implement LIVE anti-spoiler secret card behavior.
- [x] Implement turn banner + timer + vote panel.
- [x] Implement host controls (configure/start/close/reset).
- [x] Add host back-to-home action that closes the created room.
- [x] Redesign UI with global CSS tokens, reusable classes, and responsive premium layout.
- [x] Add persisted light/dark theme toggle behavior.
- [x] Apply post-redesign hardening for secret reveal hold interactions and theme toggle accessibility semantics.
- [x] Generate three redesign concept images for direction selection (`output/imagegen/redesign-option-{1,2,3}.png`).
- [x] Add host lobby source mode (`CUSTOM` vs `RANDOM`) and multi-category random selection controls.
- [x] Rework visual language to a game-first command-deck style (less generic SaaS, stronger thematic atmosphere).
- [x] Expose A/B visual routes for style variants (`/v1` and `/v3`) and keep invite links variant-aware.
- [x] Add scannable invite QR code rendering for room links (including route variant prefixes).
- [x] Fix invite/reconnect room flow: prioritize join-first UX on invite links and prevent stale `ROOM_NOT_FOUND` from disrupting active rooms.
- [x] Add host-managed local players (add/remove in lobby, local secret reveal support, and host-managed local voting) so extra devices are optional.
- [x] Make live rounds non-blocking: allow host manual voting for any alive player and add host `Next Word` continuation from in-game phases.
- [ ] Select one redesign direction and break it down into component/token implementation tasks.
- [x] Auto-compute civilian count from total players and local-undercover/mrWhite settings in host lobby controls.
- [x] Align role naming for Spanish locale to "Infiltrado" and adjust Mr. White/Undercover distinction in UI copy.
- [x] Complete host local player rename flow in lobby UI (edit controls + wired action).
- [x] Treat local no-device players as ready-equivalent for start validation to avoid false INVALID_STATE on local-only sessions.
- [x] Re-sync host lobby configuration automatically before start to avoid stale role-count state when pressing Start immediately after editing settings.
- [x] Simplify reveal host handoff copy and clear local preview on next-reveal to minimize accidental cross-player info leakage on shared-device play.
- [x] Enforce shared-device reveal lock based on `currentRevealPlayerId` during LIVE reveal, so only the active turn holder can reveal on their phone handoff.
- [x] Consolidate LIVE reveal controls into one active-turn panel so the target player and 'Siguiente' action are always in the same place.
- [x] Remove host local-secret access path from LIVE reveal screen to prevent non-assigned tap-to-reveal by pass-around device participants.
- [x] Add per-player reveal attempt counters and lock secret card rendering to active player on LIVE reveal; keep host path compatible with all-local/manual desks.
- [x] Restrict LIVE reveal secret broadcasts to the active card holder when local-only players are present, while preserving connected-player broadcast behavior for standard sessions.
- [x] Prevent `player:secret` fanout overwrite in LIVE multi-device sessions by adding playerId envelope and client-side filtering.
- [x] Improve lobby ready visibility and vote acknowledgement text so every player can confirm their readiness/vote state reliably across devices.
- [x] Remove hold-to-reveal secret interactions on mobile and switch to explicit tap reveal with locked anti-selection presentation to prevent accidental text selection.
- [x] Show role-specific vote resolution modal messaging (`Civil` / `Infiltrado` / `Mr White`) with clear continue/restart host action and localized category labels in lobby.
- [x] Reduce ambiguous near-synonym word pairs in the default deck (`sofa/sillón` class) and ensure localized pair quality remains broad across languages.
- [x] Add compact in-room mobile chrome and a quick "my word" review action for personal-device play after reveal.
- [x] Fix resolve continuation UX so non-winning eliminations continue clues on the same word instead of forcing next-word restart.
- [x] Prioritize invite-link home entry with a simplified join-first view (name + join primary) and de-emphasize create path in invite context.
- [x] Add canonical invite route `/join/:roomCode` (and variant-prefixed forms) and generate QR/link shares against this route.
- [x] Simplify discussion (`CLUES`) UI into a speaker-first mobile panel with one dominant host action (next/pause/resume).
- [x] Fix LIVE mixed reveal flow (`host + remote devices + local no-device`) so connected players reveal their own secret while host manages only local reveal turns.
- [x] Support mixed voting UX where host registers local no-device votes and connected players vote from their own devices.
- [x] Include host in mixed LIVE reveal order (`host + local no-device`) so host also gets an explicit reveal turn while remotes continue self-reveal.
- [x] Enforce reveal completion gate: host cannot close reveal until every alive player opened secret at least once (including multi-device sessions).
- [x] Let host force `Siguiente turno` even when timer is enabled, while preserving pause/resume controls.
- [x] Remove host self-secret quick action during reveal stage to avoid shared-device confusion and accidental “all same role” perception.
- [x] Preserve host-only room for reconnect grace on browser refresh so host can rejoin with token/session.
- [x] Restrict post-start joins to previous participants only (token/name reclaim), keep empty rooms for up to 1 hour, and require host continue/close when reconnecting after 10+ idle minutes.
- [x] Simplify setup to random deck + categories only, remove create-mode selector in UI, and default turns to manual (no timer).
- [x] Add branded game logo asset and localized game name (`Impostor` ES / `Mr. White` EN) in app chrome.
- [x] Add in-match host controls to end game immediately (room deletion) and schedule host transfer to a connected device player for the next round.
- [x] Add host-side confirmation modal before `Terminar juego ahora` to prevent accidental room deletion on mobile.

## Phase 4 - Validation
- [x] Unit tests for role assignment, transitions, tally, victory logic.
- [x] Integration test for 6-player full flow.
- [x] Integration test for reconnect mid-round.
- [x] Verify `/public` never receives secret payloads.
- [x] Add socket-level auth/session regression tests (stale socket, host-key checks, same-room rejoin).
- [x] Add scripted pilot simulation runner for multi-match E2E reliability checks.
- [x] Add Playwright smoke test with selector contract stable across redesigns.
- [x] Add server unit coverage for random source category-array filtering and legacy single-category compatibility.
- [x] Add server coverage for `startNextWord` and host-socket integration tests for manual connected-player votes + next-word flow.
- [x] Add integration tests for host close-room during active match and host transfer applied on next round with new host key delivery.

## Phase 5 - Playtest and Ops
- [x] Define local runbook and tunnel command examples.
- [x] Add mode-specific pilot ops scripts (`pilot-up`, `pilot-down`, `pilot-validate`) and document usage.
- [ ] Run a live 6-10 player pilot session.
- [ ] Record issues and promote fixes to changelog + decisions.
- [ ] Run a real-device idle-resume playtest: disconnect all players, wait >10 min, verify host resume modal blocks actions until host continues or closes.
