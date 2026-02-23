# Subagent Fallback Report - 2026-02-23

## Context
- Task: mobile-first invite flow + presence reliability + discussion UX simplification.
- Expected routing policy: `explorer_fast -> implementer_balanced -> reviewer_deep`.

## Failure
- Command: `functions.spawn_agent` with `agent_type=explorer_fast`.
- Result: `agent type is currently not available`.

## Fallback Applied
- Continued with single-agent implementation in this session.
- Preserved validation rigor by running:
  - `npm run test --workspace server`
  - `npm run build --workspace client`
  - `npm run test:smoke`

## Impact
- No functional blocker for delivery.
- Lost potential speed/segmentation benefits from subagent routing.

## Additional Failure (Idle Rejoin Pass)
- Command: `functions.spawn_agent` with `agent_type=explorer`.
- Result: `collab spawn failed: agent thread limit reached (max 6)`.

### Fallback Applied
- Continued with single-agent implementation for idle-rejoin policy (`1h` empty-room TTL, `10m` host resume prompt, post-start join restrictions).
- Validation commands:
  - `npm run test --workspace server`
  - `npm run build`
  - `npm run test:smoke`

## Additional Failure (Host Transfer Pass)
- Command: `functions.spawn_agent` with `agent_type=explorer_fast`.
- Result: `agent type is currently not available`.

### Fallback Applied
- Continued with single-agent implementation for host close-room and host-transfer-next-round controls.
- Validation commands:
  - `npm run test --workspace server`
  - `npm run build --workspace client`
  - `npm run test:smoke`
