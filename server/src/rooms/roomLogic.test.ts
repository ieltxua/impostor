import { describe, expect, it } from 'vitest';

import type { Settings } from '@impostor/shared';

import {
  applyMrWhiteGuess,
  castVote,
  closeReveal,
  configureRoom,
  createRoom,
  finalizeResolve,
  getPlayerById,
  joinAsPlayer,
  resolveVotePhase,
  setPlayerReady,
  startGame
} from './roomLogic.js';

function withPlayers(count: number, settings: Settings) {
  const { room, hostPlayer } = createRoom({
    code: 'ABCDE',
    mode: 'LIVE',
    hostName: 'Host',
    hostSocketId: 'socket-host',
    hostPlayerToken: 'token-host'
  });

  for (let i = 1; i < count; i += 1) {
    joinAsPlayer(room, {
      name: `P${i}`,
      socketId: `socket-${i}`,
      playerToken: `token-${i}`
    });
  }

  for (const player of room.players) {
    setPlayerReady(room, player.id, true);
  }

  configureRoom(room, {
    settings,
    wordSource: { type: 'CUSTOM', pair: { a: 'Pizza', b: 'Empanada', category: 'Food' } }
  });

  return { room, hostPlayer };
}

describe('roomLogic', () => {
  it('assigns roles exactly matching configured counts', () => {
    const settings: Settings = {
      roleCounts: { civil: 4, undercover: 1, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(6, settings);

    startGame(room, () => 0.42);

    const alive = room.players.filter((player) => player.alive);
    const roleCounts = alive.reduce<Record<string, number>>((acc, player) => {
      acc[player.role ?? 'NONE'] = (acc[player.role ?? 'NONE'] ?? 0) + 1;
      return acc;
    }, {});

    expect(roleCounts.CIVIL).toBe(4);
    expect(roleCounts.UNDERCOVER).toBe(1);
    expect(roleCounts.MR_WHITE).toBe(1);
    expect(room.status).toBe('REVEAL');
  });

  it('locks reveal after closing reveal in LIVE mode', () => {
    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: 20,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(3, settings);

    startGame(room, () => 0.12);
    closeReveal(room, () => 0.75);

    expect(room.status).toBe('CLUES');
    expect(room.revealAllowed).toBe(false);
    expect(room.turnOrder).toHaveLength(3);
  });

  it('resolves vote ties by selecting one tied candidate', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(4, settings);

    startGame(room, () => 0.21);
    room.status = 'VOTE';
    room.votes = {};

    const [p1, p2, p3, p4] = room.players;
    castVote(room, { voterId: p1.id, targetPlayerId: p2.id });
    castVote(room, { voterId: p2.id, targetPlayerId: p1.id });
    castVote(room, { voterId: p3.id, targetPlayerId: p2.id });
    castVote(room, { voterId: p4.id, targetPlayerId: p1.id });

    const { elimination } = resolveVotePhase(room, () => 0.0);

    expect([p1.id, p2.id]).toContain(elimination.eliminatedPlayerId);
    expect(room.status).toBe('RESOLVE');
  });

  it('ends game with civilians when Mr White is eliminated in SIMPLE mode', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(4, settings);

    startGame(room, () => 0.19);
    room.status = 'VOTE';
    room.votes = {};

    const mrWhite = room.players.find((player) => player.role === 'MR_WHITE');
    expect(mrWhite).toBeTruthy();

    for (const player of room.players) {
      castVote(room, {
        voterId: player.id,
        targetPlayerId: mrWhite!.id
      });
    }

    resolveVotePhase(room, () => 0.4);
    const finalized = finalizeResolve(room);

    expect(finalized.ended).toBe(true);
    if (finalized.ended) {
      expect(finalized.winner).toBe('CIVILIANS');
    }
  });

  it('supports CLASSIC_GUESS branch for eliminated Mr White', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: true,
      showVoteTally: true,
      winPreset: 'CLASSIC_GUESS'
    };
    const { room } = withPlayers(4, settings);

    startGame(room, () => 0.33);
    room.status = 'VOTE';
    room.votes = {};

    const mrWhite = room.players.find((player) => player.role === 'MR_WHITE');
    expect(mrWhite).toBeTruthy();

    for (const player of room.players) {
      castVote(room, {
        voterId: player.id,
        targetPlayerId: mrWhite!.id
      });
    }

    const { awaitingGuess } = resolveVotePhase(room, () => 0.5);
    expect(awaitingGuess).toBe(true);

    const before = getPlayerById(room, mrWhite!.id);
    expect(before?.alive).toBe(false);

    applyMrWhiteGuess(room, { playerId: mrWhite!.id, guess: 'WrongGuess' });
    const finalized = finalizeResolve(room);

    expect(finalized.ended).toBe(true);
    if (finalized.ended) {
      expect(finalized.winner).toBe('CIVILIANS');
    }
  });
});
