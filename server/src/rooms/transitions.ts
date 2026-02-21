import type { Player, Role, Winner } from '@impostor/shared';

import type { RoomRuntime } from './roomStore.js';

export interface VoteResolution {
  eliminatedPlayerId: string;
  revealedRole: Role;
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
    throw new Error('Role counts must match ready player count.');
  }
  if (counts.mrWhite !== 1) {
    throw new Error('MVP requires exactly one Mr White.');
  }
  if (counts.civil < 1) {
    throw new Error('At least one civilian is required.');
  }
}

export function getAlivePlayers(room: RoomRuntime): Player[] {
  return room.players.filter((player) => room.alivePlayerIds.includes(player.id));
}

export function computeVoteProgress(room: RoomRuntime): { votesCast: number; votesTotal: number } {
  const connectedAliveSet = new Set(
    room.players.filter((player) => player.connected && room.alivePlayerIds.includes(player.id)).map((player) => player.id)
  );
  let votesCast = 0;
  for (const voterId of Object.keys(room.votes)) {
    if (connectedAliveSet.has(voterId)) {
      votesCast += 1;
    }
  }
  return { votesCast, votesTotal: connectedAliveSet.size };
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
  if (elimination.revealedRole === 'MR_WHITE') {
    if (room.settings.winPreset === 'CLASSIC_GUESS' && room.settings.mrWhiteCanGuessOnElim) {
      return undefined;
    }
    return {
      winner: 'CIVILIANS',
      reason: 'Mr White was eliminated.'
    };
  }

  const mrWhiteAlive = room.players.some((player) => player.role === 'MR_WHITE' && room.alivePlayerIds.includes(player.id));
  if (mrWhiteAlive && room.alivePlayerIds.length <= 2) {
    return {
      winner: 'IMPOSTORS',
      reason: 'Mr White survived until the final two players.'
    };
  }

  return undefined;
}
