import type { Player, Role, Winner } from '@impostor/shared';

import type { RoomRuntime } from './roomStore.js';

export interface VoteResolution {
  eliminatedPlayerId: string;
  revealedRole: Role;
}

interface AliveRoleCounts {
  civil: number;
  undercover: number;
  mrWhite: number;
}

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function validateRoleCounts(playerCount: number, counts: { civil: number; undercover: number; mrWhite: number }): void {
  const total = counts.civil + counts.undercover + counts.mrWhite;
  if (total !== playerCount) {
    throw new Error(`Role counts must match ready player count. Configured ${total}, ready ${playerCount}.`);
  }
  if (counts.mrWhite < 1) {
    throw new Error('At least one Mr White is required.');
  }
  if (counts.civil < 1) {
    throw new Error('At least one civilian is required.');
  }
}

export function getAlivePlayers(room: RoomRuntime): Player[] {
  return room.players.filter((player) => room.alivePlayerIds.includes(player.id));
}

export function computeVoteProgress(room: RoomRuntime): { votesCast: number; votesTotal: number } {
  const voteEligibleAliveSet = new Set(
    room.players
      .filter((player) => room.alivePlayerIds.includes(player.id) && (player.connected || player.isLocalOnly))
      .map((player) => player.id)
  );
  let votesCast = 0;
  for (const voterId of Object.keys(room.votes)) {
    if (voteEligibleAliveSet.has(voterId)) {
      votesCast += 1;
    }
  }
  return { votesCast, votesTotal: voteEligibleAliveSet.size };
}

export function resolveVotes(room: RoomRuntime, rng: () => number = Math.random): VoteResolution {
  const aliveSet = new Set(room.alivePlayerIds);
  const counts: Record<string, number> = {};

  for (const [voterId, targetId] of Object.entries(room.votes)) {
    if (!aliveSet.has(voterId) || !aliveSet.has(targetId)) {
      continue;
    }
    counts[targetId] = (counts[targetId] ?? 0) + 1;
  }

  const entries = Object.entries(counts);
  if (entries.length === 0) {
    throw new Error('No valid votes to resolve.');
  }

  const maxVotes = Math.max(...entries.map(([, value]) => value));
  const tied = entries.filter(([, value]) => value === maxVotes).map(([playerId]) => playerId);
  const eliminatedPlayerId = tied[Math.floor(rng() * tied.length)];

  const eliminatedPlayer = room.players.find((player) => player.id === eliminatedPlayerId);
  if (!eliminatedPlayer?.role) {
    throw new Error('Eliminated player role was not assigned.');
  }

  return {
    eliminatedPlayerId,
    revealedRole: eliminatedPlayer.role
  };
}

export function evaluateImmediateWinner(room: RoomRuntime, elimination: VoteResolution): { winner: Winner; reason: string } | undefined {
  const counts: AliveRoleCounts = room.players.reduce(
    (acc, player) => {
      if (!room.alivePlayerIds.includes(player.id) || !player.role) {
        return acc;
      }
      if (player.role === 'CIVIL') {
        acc.civil += 1;
      } else if (player.role === 'UNDERCOVER') {
        acc.undercover += 1;
      } else {
        acc.mrWhite += 1;
      }
      return acc;
    },
    { civil: 0, undercover: 0, mrWhite: 0 }
  );

  const aliveImpostors = counts.undercover + counts.mrWhite;
  const mrWhiteCanAttemptGuessOnElim =
    elimination.revealedRole === 'MR_WHITE' &&
    room.settings.winPreset === 'CLASSIC_GUESS' &&
    room.settings.mrWhiteCanGuessOnElim;

  if (aliveImpostors === 0) {
    if (mrWhiteCanAttemptGuessOnElim) {
      return undefined;
    }
    return {
      winner: 'CIVILIANS',
      reason: 'All infiltrators were eliminated.'
    };
  }

  if (counts.civil <= 0) {
    return {
      winner: 'IMPOSTORS',
      reason: 'No civilians remain alive.'
    };
  }

  if (aliveImpostors >= counts.civil) {
    return {
      winner: 'IMPOSTORS',
      reason: 'Impostors reached civilian parity.'
    };
  }

  return undefined;
}
