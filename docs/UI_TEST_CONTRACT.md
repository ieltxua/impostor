# UI Smoke Test Contract

This file defines the stable `data-testid` contract used by `/Users/ieltxualganaras/projects/impostor/e2e/tests/smoke.spec.ts`.

Purpose: allow major visual redesigns without rewriting smoke tests.

## Contract Rules
- Keep these `data-testid` values stable even if layout/style/wording changes.
- You can move elements, restyle components, and change typography freely.
- If any selector must change, update this file and the smoke test in the same PR.

## Required Selectors

### Home
- `home-screen`
- `home-create-name`
- `home-create-submit`
- `home-join-name`
- `home-join-room-code`
- `home-join-submit`

### Lobby
- `lobby-screen`
- `lobby-room-code`
- `lobby-players-list`
- `lobby-ready-toggle`

### Host Controls
- `host-role-civil`
- `host-role-undercover`
- `host-role-mrwhite`
- `host-turn-seconds`
- `host-apply-config`
- `host-start-game`

### Gameplay
- `game-screen`
- `game-status`
- `host-close-reveal`
- `host-next-turn`
- `vote-panel`
- `vote-target-<player-id>` (prefix contract)
- `host-close-vote`
- `host-reset-room`

## Smoke Scope (Intent)
- Host can create room.
- Second player can join by code.
- Host can configure/start game.
- Match can progress from `REVEAL -> CLUES -> VOTE -> END`.

Anything outside this scope belongs in socket simulation or deeper integration tests.
