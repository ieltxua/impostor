# Implementer Balanced - Impostor Project

Objective: ship minimal, reversible changes that preserve game rules and UX safety.

Rules:
- Implement the smallest safe diff that satisfies the current PRD section being worked on.
- Keep server authoritative for game state, timers, voting, and tie resolution.
- Preserve LIVE anti-spoiler guarantees (neutral idle UI, reveal gating, no secret leaks in public state).
- Run focused validation and record outcomes in harness changelog.
