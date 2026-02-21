# Automation: Pilot Simulation + UI Smoke

## Why
- Real 6-10 player pilots are hard to schedule repeatedly.
- This project now supports scripted pilot-grade checks plus lightweight UI smoke.

## 1) Socket Simulation (no manual players)

Run from repo root:

```bash
npm run sim:pilot -- --players 8 --matches 20 --verbose
```

Chaos run (aggressive reconnect drills):

```bash
npm run sim:pilot:chaos
```

Useful flags:

```bash
npm run sim:pilot -- --players 10 --matches 50 --seed 42 --chaos --disconnect-rate 0.5
```

Behavior notes:
- Reconnect drill is guaranteed at least once per run (match 1), even without `--chaos`.
- Invariant failures (stale-socket rejection, replacement vote acceptance, public secret leaks) fail the run.

Output:
- JSON report saved to `reports/sim/pilot-sim-<timestamp>.json`.
- Non-zero exit if one or more matches fail.

## 2) Playwright UI Smoke (selector-stable)

Run from repo root:

```bash
npm run test:smoke
```

Headed mode:

```bash
npm run test:smoke:headed
```

Notes:
- Smoke relies on `data-testid` contract documented in `docs/UI_TEST_CONTRACT.md`.
- Scope is intentionally narrow so redesigns do not force major test rewrites.

## 3) Recommended PR Gate

For fast confidence before merge:

```bash
npm run sim:pilot -- --players 8 --matches 10
npm run test:smoke
```

For deeper reliability pass (nightly or pre-release):

```bash
npm run sim:pilot -- --players 10 --matches 100 --chaos --disconnect-rate 0.5
```
