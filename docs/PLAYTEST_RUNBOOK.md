# Playtest Runbook (Phase 5)

## Purpose
Run a live 6-10 player MVP session with repeatable startup, validation, and incident capture.

## Mode Selection
Use one of these modes per session:

1. **Dev mode (local/LAN):** server on `3000`, Vite client on `5173`.
2. **Pilot mode (recommended for internet players):** built client served by server on `3000` (single-origin).

## Preconditions
- Node/npm installed.
- Dependencies installed: `npm install`.
- Host machine can keep terminals open during session.

## 1. Start App

### A. Dev mode (local/LAN)

```bash
./scripts/dev-up.sh
./scripts/pilot-validate.sh dev
```

Host URL: `http://localhost:5173/`

### B. Pilot mode (recommended remote)

```bash
./scripts/pilot-up.sh
./scripts/pilot-validate.sh pilot
```

Host URL: `http://localhost:3000/`

## 2. Open Tunnel for Remote Players
Recommended provider order:
1. `cloudflared`
2. `ngrok`
3. `localtunnel`

### Pilot mode (single-origin)
Tunnel `3000` and share that URL:

```bash
./scripts/tunnel-up.sh 3000 cloudflared
```

### Dev mode (advanced only)
If you must run remote players on Vite dev server, you need both web + API exposure and explicit server URL wiring:

```bash
# terminal A: expose API
./scripts/tunnel-up.sh 3000 cloudflared

# terminal B: run client with the API tunnel URL
VITE_SERVER_URL="https://<api-tunnel-url>" npm run dev --workspace client -- --host 0.0.0.0 --port 5173

# terminal C: expose web app
./scripts/tunnel-up.sh 5173 cloudflared
```

## 3. Session Setup Checklist
- Host opens the same URL players will use.
  - Pilot mode: open tunnel URL.
  - Dev mode: local/LAN URL.
- Host creates room and shares room code + app link.
- Verify all players appear in lobby and are marked ready.
- Host config:
  - Role counts sum equals ready players.
  - Timer mode selected (manual or seconds).
  - Word source selected.

## 4. Pilot Execution Script (Operator)
For each round:
1. Start in lobby and confirm all ready.
2. Start game and verify `REVEAL` secrets delivered.
3. Close reveal and verify `LIVE` secrets lock correctly.
4. Run clues turns.
5. Enter vote; verify one vote per connected alive player.
6. Resolve elimination and confirm role-only reveal.
7. Repeat until `END` and winner announced.

## 5. Reconnect Drill (Mandatory)
During `CLUES` or `VOTE`:
- Ask one player to refresh or reconnect.
- Confirm player rebinds to same identity.
- Confirm stale old socket cannot cast actionable events.

## 6. Public Mode Safety Drill
- Open `/public?room=ROOMCODE` in a separate browser/window.
- Confirm board shows only public state.
- Confirm no secret role/word appears there.

## 7. Incident Logging During Session
Use:
- `docs/pilot/PILOT_ISSUES_TEMPLATE.md`

Capture at minimum:
- severity, repro, expected vs actual, evidence, candidate fix.

## 8. End Session
### Dev mode

```bash
./scripts/dev-down.sh
```

### Pilot mode

```bash
./scripts/pilot-down.sh
```

If ports remain occupied:

```bash
./scripts/dev-down.sh --kill-port-listeners
./scripts/pilot-down.sh --kill-port-listeners
```

If a tunnel remains open, stop it with `Ctrl+C` in the tunnel terminal.

## 9. Post-Session Documentation
- Fill `docs/pilot/PILOT_POSTMORTEM_TEMPLATE.md`.
- Promote stable decisions to `harness/DECISIONS.md`.
- Promote follow-up work to `harness/TASKS.md`.
- Append outcomes to `harness/CHANGELOG.md`.

## 10. Quick Troubleshooting
- Port in use:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

- Restart dev mode:

```bash
./scripts/dev-down.sh
./scripts/dev-up.sh
```

- Restart pilot mode:

```bash
./scripts/pilot-down.sh
./scripts/pilot-up.sh
```

## 11. Automation Fallback (No Live Group Available)
- Run socket simulation to emulate repeated pilot sessions:

```bash
npm run sim:pilot -- --players 8 --matches 20 --verbose
```

- Run UI smoke to verify core create/join/start/end path:

```bash
npm run test:smoke
```

- See `/Users/ieltxualganaras/projects/impostor/docs/AUTOMATION_SIMULATION.md` for advanced chaos options.
