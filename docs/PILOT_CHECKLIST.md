# Pilot Checklist (6-10 Players)

## Preflight
- [ ] `npm install` completed.
- [ ] Session mode selected (`dev` or `pilot`).
- [ ] App started:
  - [ ] Dev mode: `./scripts/dev-up.sh`
  - [ ] Pilot mode: `./scripts/pilot-up.sh`
- [ ] Validation run:
  - [ ] Dev mode: `./scripts/pilot-validate.sh dev`
  - [ ] Pilot mode: `./scripts/pilot-validate.sh pilot`
- [ ] Health endpoint returns JSON with `"ok": true`.
- [ ] Tunnel started and reachable from external device.
- [ ] Issue log opened from `docs/pilot/PILOT_ISSUES_TEMPLATE.md`.

## Lobby
- [ ] Room created successfully.
- [ ] All players joined with unique names.
- [ ] Role counts match ready players.
- [ ] Host config applied without errors.

## Gameplay
- [ ] Reveal secrets delivered to each player.
- [ ] LIVE mode locks secret review after reveal close.
- [ ] Clues phase progresses correctly.
- [ ] Vote phase accepts only connected alive votes.
- [ ] Resolve phase reveals role only.
- [ ] End phase announces winner and words A/B.

## Reliability Drills
- [ ] Reconnect drill in `CLUES` passed.
- [ ] Reconnect drill in `VOTE` passed.
- [ ] Stale socket action rejected.
- [ ] `/public` never receives secret events.

## Exit Criteria
- [ ] At least one full match completed.
- [ ] No unresolved P0/P1 issues.
- [ ] Postmortem drafted in `docs/pilot/PILOT_POSTMORTEM_TEMPLATE.md`.
- [ ] Tasks and decisions updated in harness docs.
