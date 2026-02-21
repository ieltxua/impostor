# PRD - Mr. White / Impostor Web (Mobile-first)

Version: 1.1 (MVP)  
Date: 2026-02-21  
Source PDF: `/Users/ieltxualganaras/projects/impostor/PRD_MrWhite_Impostor_Web_v1.1.pdf`  
Extraction artifacts:
- `/Users/ieltxualganaras/projects/impostor/tmp/pdfs/PRD_MrWhite_Impostor_Web_v1.1.pages.txt`
- `/Users/ieltxualganaras/projects/impostor/tmp/pdfs/prd_page-01.png`
- `/Users/ieltxualganaras/projects/impostor/tmp/pdfs/prd_page-07.png`
- `/Users/ieltxualganaras/projects/impostor/tmp/pdfs/prd_page-14.png`

## 0. Harness Documents (Start Here)
- Tasks: `/Users/ieltxualganaras/projects/impostor/harness/TASKS.md`
- Decisions: `/Users/ieltxualganaras/projects/impostor/harness/DECISIONS.md`
- Changelog: `/Users/ieltxualganaras/projects/impostor/harness/CHANGELOG.md`
- Telemetry evidence: `/Users/ieltxualganaras/projects/impostor/reports/telemetry/codex-usage-2026-02-21.md`
- Project subagent config: `/Users/ieltxualganaras/projects/impostor/.codex/config.toml`

## 0.1 Goal Clarity
Goal:
- Build a web, mobile-first social deduction game that supports in-person and remote play, with realtime sync and zero account friction.

Success criteria:
- Room creation to game start in under 60 seconds for 6-10 players.
- No accidental secret leaks in LIVE mode.
- Stable reconnection behavior.
- 10-15 players per room with acceptable perceived latency.

Constraints:
- MVP excludes embedded audio/video.
- Local-hosted by default (Mac), optionally exposed via tunnel.
- Server-authoritative game state.
- Privacy-first: no PII persistence by default.

Assumptions:
- This markdown is the canonical implementation target for MVP.
- Role routing follows `explorer_fast -> implementer_balanced -> reviewer_deep`.
- Harness docs are updated during implementation.

Context classification:
- High-context (repo/product-specific rules and state machine).

## 1. Vision and Objectives
Build a no-install mobile web experience for Mr. White / Impostor where players join with QR/link, receive private roles/words, and progress through turns and votes in realtime.

Core objectives:
- Fast room creation and share flow.
- Two modes: `LIVE` and `REMOTE`.
- End-to-end game loop: `LOBBY -> REVEAL -> CLUES -> VOTE -> RESOLVE -> END`.
- Minimum operational overhead and privacy-first defaults.

## 2. MVP Scope and Non-goals
Included in MVP:
- Mobile-first web app (iOS Safari, Android Chrome).
- Room code + QR share.
- Roles: `CIVIL`, `UNDERCOVER` (optional), `MR_WHITE`.
- Word selection from local deck or custom A/B.
- Secret vote, resolve with random tie-break.
- End screen with winner and word reveal.

Out of scope (MVP):
- Embedded A/V calling.
- Accounts, profiles, persistent cloud analytics.
- Perfect anti-cheat protection.
- Public matchmaking.
- Cloud-scale multi-room orchestration.

## 3. Personas and Key Use Cases
Personas:
- Host: creates room, configures game, controls transitions, closes voting, resets room.
- Player: joins room, receives secret, provides clue, votes, follows game state.
- Public screen spectator: sees only non-secret public state.

Use cases:
- In-person table game with QR join and anti-spoiler phone UX.
- Remote game coordinated by external call.
- Stream/demo mode via `/public`.

## 4. Game Definition
Roles:
- `CIVIL` gets Word A.
- `UNDERCOVER` gets Word B.
- `MR_WHITE` gets no word.

Phases:
- `LOBBY`, `REVEAL`, `CLUES`, `VOTE`, `RESOLVE`, `END`.

Victory presets:
- `SIMPLE` (recommended): civilians win if Mr White is eliminated; impostor side wins if Mr White survives to final 2.
- `CLASSIC_GUESS` (optional): Mr White can guess Word A on elimination for a comeback win.

Voting tie-break:
- Server randomly eliminates one of the tied highest-vote players.

## 5. Functional Requirements
### 5.1 MUST
- Room create/join with short code and QR.
- Unique player name per room, no login required.
- Host config: mode, role counts, word source, timer settings.
- Server-private secret delivery (`player:secret`).
- LIVE mode reveal lock after `host:closeReveal`.
- Server-authoritative turns and optional timer.
- Secret vote during `VOTE` only.
- Resolve elimination, reveal only role, evaluate victory.
- End screen includes winner and words A/B.

### 5.2 SHOULD
- Public display route (`/public`) with zero secret data.
- Reconnection with `playerToken` (localStorage).
- Host kick before game start.
- Optional turn end beep.
- Reset room action after game.

### 5.3 COULD
- PWA support.
- ES/EN i18n.
- Round log export (JSON).
- Optional Web Speech announcements.

## 6. LIVE Mode Anti-spoiler UX
Principle:
- Any idle player screen must be safe if visible to others.

Rules:
- Neutral idle screen by default.
- Intentional reveal gesture (press-and-hold 2-3 seconds).
- Auto-hide on release/timeout.
- Hard block on post-Reveal secret review in LIVE mode.
- Same neutral layout shell for all roles.
- Avoid persistent role labels outside reveal window.

## 7. Technical Architecture
Recommended stack:
- Server: Node.js + TypeScript + Socket.IO (+ Express optional).
- Client: Vite + React + TypeScript.
- Shared types in `shared/types`.
- In-memory room persistence for MVP.

Topology:
- Mac-hosted server.
- LAN for local play.
- HTTPS tunnel for remote play.

Non-functional requirements:
- 10-15 players per room.
- Fast perceived updates for turns/votes.
- Mobile browser compatibility.
- Basic security: randomized room codes, host key validation, join rate limiting.

## 8. Realtime Contracts and Data Model
Client -> Server events:
- `room:create { mode }`
- `room:join { roomCode, name, playerToken? }`
- `room:ready { ready: true }`
- `host:configure { settings, wordSource }`
- `host:start {}`
- `host:closeReveal {}`
- `turn:next {}`
- `vote:cast { targetPlayerId }`
- `vote:close {}`
- `mrwhite:guess { guess }`
- `host:resetRoom {}`

Server -> Client events:
- `room:state_public { roomPublicState }`
- `player:secret { role, wordOrNull, revealAllowed }`
- `phase:update { status }`
- `turn:update { currentSpeakerId, timeRemaining }`
- `vote:update { votesCast, votesTotal }`
- `resolve:elimination { eliminatedPlayerId, revealedRole }`
- `game:end { winner, reason, wordPair }`

Public vs secret state:
- Public state must never include role/word assignments.
- Secret payloads must be private to player socket and reveal-gated.

## 9. Codex-ready Implementation Spec
Suggested repo layout:
```text
repo/
  client/
    src/
      pages/{Home,Lobby,Game,Public}.tsx
      components/{QRCode,SecretCard,TurnBanner,VotePanel}.tsx
      state/{socket,roomStore}.ts
      assets/words_es.json
  server/
    src/
      index.ts
      rooms/{roomStore,roomLogic,transitions}.ts
      socket/{handlers,auth}.ts
  shared/
    types/{room,events,words}.ts
```

Canonical shared types:
- `Role = 'CIVIL' | 'UNDERCOVER' | 'MR_WHITE'`
- `Mode = 'LIVE' | 'REMOTE'`
- `Status = 'LOBBY' | 'REVEAL' | 'CLUES' | 'VOTE' | 'RESOLVE' | 'END'`
- `Settings = {`
- `  roleCounts: { civil: number; undercover: number; mrWhite: number };`
- `  turnSeconds: number | null;`
- `  allowSecretReviewInRemote: boolean;`
- `  mrWhiteCanGuessOnElim: boolean;`
- `  showVoteTally: boolean;`
- `  winPreset: 'SIMPLE' | 'CLASSIC_GUESS';`
- `}`
- `WordPair = { a: string; b: string; category?: string }`
- `RoomPublicState = {`
- `  code: string;`
- `  mode: Mode;`
- `  status: Status;`
- `  playersPublic: Array<{ id: string; name: string; ready: boolean; alive: boolean; isHost: boolean }>;`
- `  roundNumber: number;`
- `  currentSpeakerId?: string;`
- `  timeRemaining?: number;`
- `  votesCast?: number;`
- `  votesTotal?: number;`
- `  lastElimination?: { eliminatedPlayerId: string; revealedRole: Role };`
- `}`
- `PlayerSecret = { role: Role; wordOrNull: string | null; revealAllowed: boolean }`
- `Room = {`
- `  code: string;`
- `  mode: Mode;`
- `  status: Status;`
- `  createdAt: number;`
- `  settings: Settings;`
- `  wordPair: WordPair;`
- `  players: Player[];`
- `  alivePlayerIds: string[];`
- `  roundNumber: number;`
- `  turnOrder: string[];`
- `  currentTurnIndex: number;`
- `  votes: Record<string, string>;`
- `  lastElimination?: { eliminatedPlayerId: string; revealedRole: Role };`
- `}`
- `Player = {`
- `  id: string;`
- `  name: string;`
- `  isHost: boolean;`
- `  connected: boolean;`
- `  role?: Role;`
- `  assignedWord?: string | null;`
- `  ready: boolean;`
- `  socketId: string;`
- `  playerToken?: string;`
- `}`

State transitions:
- `LOBBY --host:start--> REVEAL`
- `REVEAL --host:closeReveal--> CLUES`
- `CLUES --turn progression--> VOTE`
- `VOTE --all votes or close--> RESOLVE`
- `RESOLVE --victory check--> CLUES or END`
- `END --host:resetRoom--> LOBBY`

Algorithms:
- Role assignment via shuffled role list (Fisher-Yates).
- Server emits `turn:update` every second when timer is enabled.
- If `turnSeconds == null`, host advances turn with `turn:next`.
- Votes stored by voter id; latest vote before close is authoritative.
- Tie-break random among top vote count.
- Reconnection rebinds by `playerToken`.
- On reconnect, resend `player:secret` only if reveal remains allowed.
- Public screen joins as spectator and never receives secret payloads.
- MVP host disconnect behavior: close room/session and notify clients.

## 10. Testing Plan and Acceptance Criteria
Acceptance:
- No secret re-view after Reveal close in LIVE mode.
- Neutral idle UI does not disclose role identity.
- Vote restrictions enforced by phase and alive status.
- Tie-break random behavior works as expected.
- Reconnect restores player state and phase.
- End screen shows winner + A/B words.

Recommended tests:
- Unit tests for role assignment, transitions, tally, victory conditions.
- Integration tests for full 6-player flow.
- Reconnection tests in `CLUES` and `VOTE`.
- Public screen tests validating secret exclusion.

## 11. Free Deployment on Mac (Tunnels)
Preferred:
- Cloudflare Quick Tunnel for temporary HTTPS URL.

Alternatives:
- ngrok free tier.
- localtunnel.
- Tailscale Funnel.

Notes:
- Tunnel URLs may be ephemeral.
- Keep local server authoritative and avoid exposing debug endpoints publicly.

## 12. Roadmap (Post-MVP)
Potential v2:
- LiveKit integration for embedded A/V.
- Keep current rules engine and wire media as separate layer.
- Evaluate Cloud vs self-host tradeoffs after MVP stability.

Appendix A (word deck schema):
```json
[
  { "category": "Food", "a": "Pizza", "b": "Empanada" },
  { "category": "Places", "a": "Beach", "b": "Desert" }
]
```

Appendix B (privacy reminders):
- No real-world identifiers stored by default.
- Reset/restart clears room state.
- Avoid logging role/word secrets outside debug mode.

## 13. Execution Plan (Detailed)
Phase 0 - Harness and governance:
- Bootstrap project subagent config and role prompts.
- Establish `TASKS`, `DECISIONS`, `CHANGELOG`, and telemetry report paths.

Phase 1 - Server foundation:
- Implement room lifecycle and host auth.
- Add shared event contracts and strict runtime validation.

Phase 2 - Client foundation:
- Build mobile-first join/lobby/reveal/clues/vote/resolve/end screens.
- Implement LIVE anti-spoiler interactions and neutral idle shell.

Phase 3 - Realtime correctness:
- Wire Socket.IO flows end-to-end.
- Add reconnection and public display route.

Phase 4 - Test and hardening:
- Implement unit + integration test suites.
- Validate acceptance criteria and residual-risk checklist.

Phase 5 - Local deployment:
- Publish tunnel-backed playtest workflow for host machine.
- Capture known limits and rollback guidance.
