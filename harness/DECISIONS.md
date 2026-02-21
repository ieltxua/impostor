# DECISIONS - Impostor Web MVP

Last updated: 2026-02-21

## Decision log

| ID | Date | Decision | Status | Rationale |
|---|---|---|---|---|
| D-001 | 2026-02-21 | MVP excludes embedded audio/video. | Accepted | Keeps MVP focused on game state and UX safety; remote play uses external call. |
| D-002 | 2026-02-21 | Undercover role is optional (`0..n`). | Accepted | Supports both 1-word and 2-word play styles with one rules engine. |
| D-003 | 2026-02-21 | Elimination reveals role only, not the assigned word. | Accepted | Preserves deduction tension and prevents late leaks. |
| D-004 | 2026-02-21 | LIVE mode enforces strict post-Reveal secret lock. | Accepted | Anti-spoiler guarantee is core MVP acceptance criterion. |
| D-005 | 2026-02-21 | Server-authoritative state machine and timer. | Accepted | Prevents client drift and simplifies correctness under reconnects. |
| D-006 | 2026-02-21 | Tie on top vote resolves by random elimination among tied players. | Accepted | Fast low-friction flow for MVP without extra tie-break rounds. |
| D-007 | 2026-02-21 | Local Mac host plus tunnel is default deployment target. | Accepted | Zero-cost path for real gameplay testing. |
| D-008 | 2026-02-21 | Use project-local subagent routing (`explorer_fast`, `implementer_balanced`, `reviewer_deep`). | Accepted | Improves repeatability for discovery/implementation/review cycles. |
| D-009 | 2026-02-21 | Harness docs are required for meaningful changes. | Accepted | Keeps decisions, pending work, and change history explicit. |
| D-010 | 2026-02-21 | Host-only socket actions require both host identity and `hostKey`. | Accepted | Prevents simple player-id/session spoofing from triggering host actions. |
| D-011 | 2026-02-21 | Vote auto-close uses connected alive players to avoid deadlocks on disconnect. | Accepted | Keeps rounds moving when a voter drops mid-vote. |
| D-012 | 2026-02-21 | Pilot tunnel provider priority is Cloudflare, then ngrok, then localtunnel. | Accepted | Balances setup friction, reliability, and free-tier usability for MVP playtests. |
| D-013 | 2026-02-21 | Remote pilot default mode is single-origin (`server + built client` on `3000`) instead of Vite dev sharing. | Accepted | Avoids dual-tunnel/env wiring errors and keeps invite links + socket origin consistent for external players. |
| D-014 | 2026-02-21 | Reliability baseline includes automated socket simulation (`sim:pilot`) before relying on manual pilot sessions. | Accepted | Enables repeatable multiplayer stress coverage without coordinating 6-10 humans every run. |
| D-015 | 2026-02-21 | UI smoke tests must target stable `data-testid` contracts, not layout/text styling. | Accepted | Preserves test value through planned visual redesign with minimal maintenance. |
| D-016 | 2026-02-21 | Playwright smoke runs on dedicated test ports (`5174` client -> `3100` server) and starts fresh servers each run. | Accepted | Prevents false confidence from stale pre-running dev processes and avoids conflicts with local manual sessions on `5173/3000`. |

## Open decisions
- O-001: Keep room code after reset or issue a new code.
- O-002: Whether to expose vote tally in real-time (`showVoteTally`) by default.
- O-003: Whether Mr White guess mode (`CLASSIC_GUESS`) ships enabled or behind host toggle.
