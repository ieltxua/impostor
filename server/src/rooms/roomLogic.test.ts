import { describe, expect, it } from 'vitest';

import { DEFAULT_WORD_DECK, type Settings } from '@impostor/shared';

import {
  addLocalPlayer,
  applyMrWhiteGuess,
  castVote,
  closeReveal,
  configureRoom,
  createRoom,
  finalizeResolve,
  getPlayerById,
  joinAsPlayer,
  getPlayerSecret,
  markRevealOpened,
  markPlayerDisconnected,
  removeLocalPlayer,
  resolveVotePhase,
  setPlayerReady,
  startGame,
  startNextWord,
  nextReveal
} from './roomLogic.js';
import { computeVoteProgress, evaluateImmediateWinner } from './transitions.js';

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

function rngSequence(values: number[], fallback = 0): () => number {
  let index = 0;
  return () => values[index++] ?? fallback;
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

  it('supports multiple Mr White roles in the same game', () => {
    const settings: Settings = {
      roleCounts: { civil: 7, undercover: 1, mrWhite: 2 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(10, settings);

    startGame(room, () => 0.12);

    const alive = room.players.filter((player) => player.alive);
    const roleCounts = alive.reduce<Record<string, number>>((acc, player) => {
      acc[player.role ?? 'NONE'] = (acc[player.role ?? 'NONE'] ?? 0) + 1;
      return acc;
    }, {});

    expect(roleCounts.CIVIL).toBe(7);
    expect(roleCounts.UNDERCOVER).toBe(1);
    expect(roleCounts.MR_WHITE).toBe(2);
    expect(room.status).toBe('REVEAL');
  });

  it('only allows previous participants to rejoin after game start', () => {
    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(3, settings);
    const existingPlayer = room.players.find((entry) => !entry.isHost);
    expect(existingPlayer).toBeTruthy();

    startGame(room, () => 0.42);
    markPlayerDisconnected(room, existingPlayer!.id);

    const reconnected = joinAsPlayer(room, {
      name: existingPlayer!.name,
      socketId: 'socket-rejoin-existing',
      playerToken: existingPlayer!.playerToken
    });
    expect(reconnected.reconnected).toBe(true);
    expect(reconnected.player.id).toBe(existingPlayer!.id);

    expect(() =>
      joinAsPlayer(room, {
        name: 'LateJoiner',
        socketId: 'socket-late',
        playerToken: 'token-late'
      })
    ).toThrowError(/previous participants/i);
  });

  it('localizes randomized word pairs when room locale is Spanish', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: 20,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    const { room } = withPlayers(4, settings);
  room.wordLocale = 'es';

    configureRoom(room, {
      settings,
      wordSource: { type: 'RANDOM', category: 'transport' }
    });

    startGame(room, () => 0);

  expect(room.wordPair.a).toBe('coche');
  expect(room.wordPair.b).toBe('motocicleta');
  expect(room.wordPair.category).toBe('Transporte');
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
    for (const player of room.players.filter((entry) => entry.alive)) {
      markRevealOpened(room, player.id);
    }
    closeReveal(room, () => 0.75);

    expect(room.status).toBe('CLUES');
    expect(room.revealAllowed).toBe(false);
    expect(room.turnOrder).toHaveLength(3);
  });

  it('keeps remote players reveal-enabled while host advances local reveal order in mixed LIVE mode', () => {
    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 1, mrWhite: 1 },
      turnSeconds: 20,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room, hostPlayer } = createRoom({
      code: 'ABCDE',
      mode: 'LIVE',
      hostName: 'Host',
      hostSocketId: 'socket-host',
      hostPlayerToken: 'token-host'
    });

    const p1 = addLocalPlayer(room, { name: 'Local 1' });
    const p2 = addLocalPlayer(room, { name: 'Local 2' });
    joinAsPlayer(room, { name: 'P2', socketId: 'socket-2', playerToken: 'token-2' });
    setPlayerReady(room, hostPlayer.id, true);
    setPlayerReady(room, p1.id, true);
    setPlayerReady(room, p2.id, true);
    setPlayerReady(room, room.players.find((entry) => entry.name === 'P2')!.id, true);

    configureRoom(room, {
      settings,
      wordSource: { type: 'CUSTOM', pair: { a: 'Pizza', b: 'Empanada', category: 'Food' } }
    });

    startGame(room, () => 0.4);

    const currentRevealId = room.currentRevealPlayerId;
    expect(currentRevealId).toBeTruthy();

    const currentPlayer = room.players.find((entry) => entry.id === currentRevealId);
    expect(currentPlayer).toBeTruthy();
    expect(Boolean(currentPlayer?.isLocalOnly || currentPlayer?.isHost)).toBe(true);
    expect(getPlayerSecret(currentPlayer!, room).revealAllowed).toBe(true);

    const remotePlayer = room.players.find((entry) => entry.connected && !entry.isLocalOnly && !entry.isHost);
    expect(room.revealPlayerOrder).toEqual(expect.arrayContaining([hostPlayer.id, p1.id, p2.id]));
    if (remotePlayer) {
      expect(room.revealPlayerOrder).not.toContain(remotePlayer.id);
    }
    if (remotePlayer) {
      expect(getPlayerSecret(remotePlayer, room).revealAllowed).toBe(true);
    }

    markRevealOpened(room, currentPlayer!.id);
    nextReveal(room);
    expect(room.currentRevealPlayerId).not.toBe(currentRevealId);
    const currentPlayerCanStillReveal = getPlayerSecret(currentPlayer!, room).revealAllowed;
    if (currentPlayer?.isLocalOnly) {
      expect(currentPlayerCanStillReveal).toBe(false);
    } else {
      expect(currentPlayerCanStillReveal).toBe(true);
    }
    if (remotePlayer) {
      expect(getPlayerSecret(remotePlayer, room).revealAllowed).toBe(true);
    }
  });

  it('resets reveal order fields when reveal is closed', () => {
    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 1, mrWhite: 1 },
      turnSeconds: 20,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(3, settings);

    startGame(room, () => 0.4);
    expect(room.currentRevealPlayerId).toBeDefined();
    for (const player of room.players.filter((entry) => entry.alive)) {
      markRevealOpened(room, player.id);
    }

    closeReveal(room, () => 0.7);

    expect(room.status).toBe('CLUES');
    expect(room.currentRevealPlayerId).toBeUndefined();
    expect(room.currentRevealPlayerIndex).toBe(0);
    expect(room.revealPlayerOrder).toEqual([]);
    expect(room.revealAllowed).toBe(false);
  });

  it('tracks reveal attempt counts for all players', () => {
    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: 20,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room, hostPlayer } = createRoom({
      code: 'ABCDE',
      mode: 'LIVE',
      hostName: 'Host',
      hostSocketId: 'socket-host',
      hostPlayerToken: 'token-host'
    });

    const localOne = addLocalPlayer(room, { name: 'Local 1' });
    const localTwo = addLocalPlayer(room, { name: 'Local 2' });

    setPlayerReady(room, hostPlayer.id, true);
    setPlayerReady(room, localOne.id, true);
    setPlayerReady(room, localTwo.id, true);

    configureRoom(room, {
      settings,
      wordSource: { type: 'CUSTOM', pair: { a: 'Pizza', b: 'Empanada', category: 'Food' } }
    });

    startGame(room, () => 0.12);

    const orderedPlayers = [...room.revealPlayerOrder];
    expect(orderedPlayers).toHaveLength(3);
    for (const playerId of orderedPlayers) {
      expect(room.revealAttemptCountsByPlayerId[playerId]).toBe(0);
    }

    const first = orderedPlayers[0];
    const second = orderedPlayers[1];
    const third = orderedPlayers[2];

    markRevealOpened(room, first);
    nextReveal(room);
    expect(room.currentRevealPlayerId).toBe(second);
    expect(room.revealAttemptCountsByPlayerId[first]).toBe(1);

    markRevealOpened(room, second);
    nextReveal(room);
    expect(room.currentRevealPlayerId).toBe(third);
    expect(room.revealAttemptCountsByPlayerId[first]).toBe(1);
    expect(room.revealAttemptCountsByPlayerId[second]).toBe(1);

    markRevealOpened(room, third);
    closeReveal(room, () => 0.5);
    expect(room.revealAttemptCountsByPlayerId[third]).toBe(1);
  });

  it('blocks nextReveal and closeReveal until required reveal opens are tracked', () => {
    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: 20,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(3, settings);
    startGame(room, () => 0.33);

    expect(() => nextReveal(room)).toThrowError(/open secret at least once/i);
    expect(() => closeReveal(room)).toThrowError(/reveal at least once/i);

    const firstRevealPlayerId = room.currentRevealPlayerId!;
    markRevealOpened(room, firstRevealPlayerId);

    if (room.revealPlayerOrder.length > 1) {
      nextReveal(room);
    }

    const remaining = room.players.filter((player) => player.alive && player.id !== firstRevealPlayerId);
    for (const player of remaining) {
      markRevealOpened(room, player.id);
    }

    closeReveal(room, () => 0.12);
    expect(room.status).toBe('CLUES');
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

  it('picks random words from any of the selected categories', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(4, settings);

    configureRoom(room, {
      settings,
      wordSource: { type: 'RANDOM', categories: ['Animals', 'Travel'] }
    });

    startGame(room, rngSequence([0.92]));

    expect(['Animals', 'Travel']).toContain(room.wordPair.category);
  });

  it('supports legacy single-category random selection', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(4, settings);

    configureRoom(room, {
      settings,
      wordSource: { type: 'RANDOM', category: 'tech' }
    });

    startGame(room, rngSequence([0.25]));

    expect(room.wordPair.category).toBe('Tech');
  });

  it('falls back to the full deck when selected random categories do not exist', () => {
    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room } = withPlayers(4, settings);

    configureRoom(room, {
      settings,
      wordSource: { type: 'RANDOM', categories: ['NotARealCategory'] }
    });

    startGame(room, rngSequence([0.9999]));

    expect(room.wordPair).toEqual(DEFAULT_WORD_DECK[DEFAULT_WORD_DECK.length - 1]);
  });

  it('adds and removes local players only while in lobby', () => {
    const { room } = withPlayers(2, {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    });

    const local = addLocalPlayer(room, { name: 'Local One' });
    expect(local.isLocalOnly).toBe(true);
    expect(local.connected).toBe(false);
    expect(local.ready).toBe(true);
    expect(room.players.some((entry) => entry.id === local.id)).toBe(true);

    removeLocalPlayer(room, local.id);
    expect(room.players.some((entry) => entry.id === local.id)).toBe(false);
  });

  it('counts local no-device players as ready when validating role counts', () => {
    const settings: Settings = {
      roleCounts: { civil: 7, undercover: 2, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    const { room } = createRoom({
      code: 'ABCDE',
      mode: 'LIVE',
      hostName: 'Host',
      hostSocketId: 'socket-host',
      hostPlayerToken: 'token-host'
    });

    for (let index = 0; index < 9; index += 1) {
      addLocalPlayer(room, { name: `Local ${index}` });
    }

    for (const player of room.players) {
      if (player.isLocalOnly) {
        player.ready = false;
      }
    }

    configureRoom(room, {
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });

    startGame(room, () => 0.4);

    expect(room.status).toBe('REVEAL');
    expect(room.players.filter((player) => player.alive)).toHaveLength(10);
  });

  it('counts alive local players in vote totals', () => {
    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room, hostPlayer } = withPlayers(1, settings);
    const local = addLocalPlayer(room, { name: 'Local One' });

    configureRoom(room, {
      settings,
      wordSource: { type: 'CUSTOM', pair: { a: 'Pizza', b: 'Empanada', category: 'Food' } }
    });

    startGame(room, () => 0.25);
    room.status = 'VOTE';
    room.votes = {};

    const initialProgress = computeVoteProgress(room);
    expect(initialProgress.votesTotal).toBe(2);
    expect(initialProgress.votesCast).toBe(0);

    castVote(room, { voterId: local.id, targetPlayerId: hostPlayer.id });
    const afterLocalVote = computeVoteProgress(room);
    expect(afterLocalVote.votesCast).toBe(1);
    expect(afterLocalVote.votesTotal).toBe(2);
  });

  it('rejects CLASSIC_GUESS + local players to avoid unreachable Mr White guess flow', () => {
    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: true,
      showVoteTally: true,
      winPreset: 'CLASSIC_GUESS'
    };
    const { room } = withPlayers(1, settings);
    addLocalPlayer(room, { name: 'Local One' });

    configureRoom(room, {
      settings,
      wordSource: { type: 'CUSTOM', pair: { a: 'Pizza', b: 'Empanada', category: 'Food' } }
    });

    expect(() => startGame(room, () => 0.25)).toThrowError(/not supported for local no-device players/i);
  });

  it('starts next word with active players and adjusts role counts when roster shrinks', () => {
    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 1, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room, hostPlayer } = withPlayers(3, settings);

    startGame(room, () => 0.33);
    room.status = 'VOTE';
    room.votes = {};

    const disconnected = room.players.find((player) => !player.isHost && player.id !== hostPlayer.id);
    expect(disconnected).toBeTruthy();
    disconnected!.connected = false;

    const next = startNextWord(room, () => 0.41);

    expect(next.adjustedRoleCounts).toBe(true);
    expect(room.status).toBe('REVEAL');
    expect(room.settings.roleCounts).toEqual({ civil: 1, undercover: 0, mrWhite: 1 });
    expect(room.players.find((player) => player.id === disconnected!.id)?.ready).toBe(false);
    expect(room.players.find((player) => player.id === hostPlayer.id)?.ready).toBe(true);
    expect(room.players.filter((player) => player.alive)).toHaveLength(2);
  });

  it('retains multiple Mr White role count when continuing with active players', () => {
    const settings: Settings = {
      roleCounts: { civil: 7, undercover: 1, mrWhite: 2 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    const { room, hostPlayer } = withPlayers(10, settings);

    startGame(room, () => 0.12);
    room.status = 'VOTE';
    room.votes = {};

    const disconnected = room.players.find((player) => !player.isHost && player.id !== hostPlayer.id);
    expect(disconnected).toBeTruthy();
    disconnected!.connected = false;

    const next = startNextWord(room, () => 0.41);

    expect(next.adjustedRoleCounts).toBe(true);
    expect(room.settings.roleCounts).toEqual({ civil: 6, undercover: 1, mrWhite: 2 });
    expect(room.players.filter((player) => player.alive)).toHaveLength(9);
  });

  it('declares impostors winner when alive impostors reach civilian parity/majority', () => {
    const { room, hostPlayer } = createRoom({
      code: 'ABCDE',
      mode: 'LIVE',
      hostName: 'Host',
      hostSocketId: 'socket-host',
      hostPlayerToken: 'token-host'
    });
    joinAsPlayer(room, { name: 'C2', socketId: 'socket-c2', playerToken: 'token-c2' });
    joinAsPlayer(room, { name: 'U1', socketId: 'socket-u1', playerToken: 'token-u1' });
    joinAsPlayer(room, { name: 'W1', socketId: 'socket-w1', playerToken: 'token-w1' });

    const c2 = room.players.find((player) => player.name === 'C2')!;
    const u1 = room.players.find((player) => player.name === 'U1')!;
    const w1 = room.players.find((player) => player.name === 'W1')!;
    hostPlayer.role = 'CIVIL';
    c2.role = 'CIVIL';
    u1.role = 'UNDERCOVER';
    w1.role = 'MR_WHITE';
    hostPlayer.alive = false;
    c2.alive = true;
    u1.alive = true;
    w1.alive = true;
    room.alivePlayerIds = [c2.id, u1.id, w1.id];

    const winner = evaluateImmediateWinner(room, {
      eliminatedPlayerId: hostPlayer.id,
      revealedRole: 'CIVIL'
    });

    expect(winner?.winner).toBe('IMPOSTORS');
  });

  it('declares civilians winner when all impostors are eliminated', () => {
    const { room, hostPlayer } = createRoom({
      code: 'ABCDE',
      mode: 'LIVE',
      hostName: 'Host',
      hostSocketId: 'socket-host',
      hostPlayerToken: 'token-host'
    });
    joinAsPlayer(room, { name: 'C2', socketId: 'socket-c2', playerToken: 'token-c2' });
    joinAsPlayer(room, { name: 'U1', socketId: 'socket-u1', playerToken: 'token-u1' });
    joinAsPlayer(room, { name: 'W1', socketId: 'socket-w1', playerToken: 'token-w1' });

    const c2 = room.players.find((player) => player.name === 'C2')!;
    const u1 = room.players.find((player) => player.name === 'U1')!;
    const w1 = room.players.find((player) => player.name === 'W1')!;
    hostPlayer.role = 'CIVIL';
    c2.role = 'CIVIL';
    u1.role = 'UNDERCOVER';
    w1.role = 'MR_WHITE';
    hostPlayer.alive = true;
    c2.alive = true;
    u1.alive = false;
    w1.alive = false;
    room.alivePlayerIds = [hostPlayer.id, c2.id];

    const winner = evaluateImmediateWinner(room, {
      eliminatedPlayerId: w1.id,
      revealedRole: 'MR_WHITE'
    });

    expect(winner?.winner).toBe('CIVILIANS');
  });

  it('defers immediate civilians win on Mr White elimination when CLASSIC_GUESS is enabled', () => {
    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: true,
      showVoteTally: true,
      winPreset: 'CLASSIC_GUESS'
    };
    const { room } = withPlayers(3, settings);
    room.settings = settings;

    const mrWhite = room.players.find((player) => player.role === 'MR_WHITE') ?? room.players[0];
    for (const player of room.players) {
      player.role = player.id === mrWhite.id ? 'MR_WHITE' : 'CIVIL';
    }
    mrWhite.alive = false;
    room.alivePlayerIds = room.players.filter((player) => player.id !== mrWhite.id).map((player) => player.id);

    const winner = evaluateImmediateWinner(room, {
      eliminatedPlayerId: mrWhite.id,
      revealedRole: 'MR_WHITE'
    });

    expect(winner).toBeUndefined();
  });
});
