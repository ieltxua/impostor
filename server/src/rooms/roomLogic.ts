import { randomBytes, randomUUID } from 'node:crypto';

import {
  DEFAULT_WORD_DECK,
  type Player,
  type PlayerSecret,
  type RoomPublicState,
  type Settings,
  type Winner,
  type WordPair,
  type WordSource
} from '@impostor/shared';

import type { RoomRuntime } from './roomStore.js';
import { computeVoteProgress, evaluateImmediateWinner, getAlivePlayers, resolveVotes, shuffle, validateRoleCounts } from './transitions.js';

const DEFAULT_WORD_PAIR: WordPair = { a: 'Pizza', b: 'Empanada', category: 'Food' };

export const DEFAULT_SETTINGS: Settings = {
  roleCounts: {
    civil: 4,
    undercover: 1,
    mrWhite: 1
  },
  turnSeconds: 45,
  allowSecretReviewInRemote: true,
  mrWhiteCanGuessOnElim: false,
  showVoteTally: true,
  winPreset: 'SIMPLE'
};

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export function createRoomCode(existingCodes: Set<string>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error('Unable to generate room code.');
}

export function createHostKey(): string {
  return randomBytes(16).toString('hex');
}

function createPlayer(params: { name: string; isHost: boolean; socketId: string; playerToken?: string }): Player {
  return {
    id: randomUUID(),
    name: params.name.trim(),
    isHost: params.isHost,
    connected: true,
    ready: params.isHost,
    alive: true,
    socketId: params.socketId,
    playerToken: params.playerToken
  };
}

export function createRoom(params: {
  code: string;
  mode: 'LIVE' | 'REMOTE';
  hostName: string;
  hostSocketId: string;
  hostPlayerToken?: string;
}): { room: RoomRuntime; hostPlayer: Player } {
  const hostPlayer = createPlayer({
    name: params.hostName,
    isHost: true,
    socketId: params.hostSocketId,
    playerToken: params.hostPlayerToken
  });

  const room: RoomRuntime = {
    code: normalizeRoomCode(params.code),
    mode: params.mode,
    status: 'LOBBY',
    createdAt: Date.now(),
    settings: structuredClone(DEFAULT_SETTINGS),
    wordPair: DEFAULT_WORD_PAIR,
    players: [hostPlayer],
    alivePlayerIds: [hostPlayer.id],
    roundNumber: 0,
    turnOrder: [],
    currentTurnIndex: 0,
    revealAllowed: true,
    votes: {},
    hostKey: createHostKey(),
    wordSource: { type: 'RANDOM' },
    awaitingMrWhiteGuess: false
  };

  return { room, hostPlayer };
}

export function joinAsPlayer(room: RoomRuntime, params: { name: string; socketId: string; playerToken?: string }): { player: Player; reconnected: boolean } {
  const sameSocket = room.players.find((player) => player.socketId === params.socketId && player.connected);
  if (sameSocket) {
    return { player: sameSocket, reconnected: true };
  }

  const token = params.playerToken?.trim();
  if (token) {
    const existing = room.players.find((player) => player.playerToken === token);
    if (existing) {
      existing.connected = true;
      existing.socketId = params.socketId;
      return { player: existing, reconnected: true };
    }
  }

  if (room.status !== 'LOBBY') {
    throw new Error('Cannot join as a new player after game start.');
  }

  const normalizedName = params.name.trim().toLowerCase();
  const nameTaken = room.players.some((player) => player.name.trim().toLowerCase() === normalizedName);
  if (nameTaken) {
    throw new Error('That name is already taken in this room.');
  }

  const player = createPlayer({
    name: params.name,
    isHost: false,
    socketId: params.socketId,
    playerToken: token
  });
  player.ready = false;

  room.players.push(player);
  room.alivePlayerIds = room.players.filter((p) => p.alive).map((p) => p.id);
  return { player, reconnected: false };
}

export function markPlayerDisconnected(room: RoomRuntime, playerId: string): void {
  const player = room.players.find((entry) => entry.id === playerId);
  if (player) {
    player.connected = false;
  }
}

export function setPlayerReady(room: RoomRuntime, playerId: string, ready: boolean): void {
  if (room.status !== 'LOBBY') {
    throw new Error('Ready state can only be changed in the lobby.');
  }
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error('Player not found.');
  }
  player.ready = ready;
}

export function configureRoom(room: RoomRuntime, payload: { settings: Settings; wordSource: WordSource }): void {
  if (room.status !== 'LOBBY') {
    throw new Error('Room can only be configured in the lobby.');
  }
  room.settings = payload.settings;
  room.wordSource = payload.wordSource;
}

function pickWordPair(source: WordSource, rng: () => number = Math.random): WordPair {
  if (source.type === 'CUSTOM') {
    return source.pair;
  }

  const deck = source.category
    ? DEFAULT_WORD_DECK.filter((entry) => entry.category.toLowerCase() === source.category?.toLowerCase())
    : DEFAULT_WORD_DECK;

  if (deck.length === 0) {
    return DEFAULT_WORD_PAIR;
  }

  return deck[Math.floor(rng() * deck.length)];
}

export function getPlayerSecret(player: Player, room: RoomRuntime): PlayerSecret {
  return {
    role: player.role ?? 'CIVIL',
    wordOrNull: player.assignedWord ?? null,
    revealAllowed: room.revealAllowed || (room.mode === 'REMOTE' && room.settings.allowSecretReviewInRemote)
  };
}

export function startGame(room: RoomRuntime, rng: () => number = Math.random): { assignedSecrets: Array<{ playerId: string; secret: PlayerSecret }> } {
  if (room.status !== 'LOBBY') {
    throw new Error('Game can only start from lobby.');
  }

  const readyPlayers = room.players.filter((player) => player.ready);
  validateRoleCounts(readyPlayers.length, room.settings.roleCounts);

  room.wordPair = pickWordPair(room.wordSource, rng);
  room.revealAllowed = true;
  room.roundNumber = 1;
  room.status = 'REVEAL';
  room.turnOrder = [];
  room.currentTurnIndex = 0;
  room.timeRemaining = undefined;
  room.votes = {};
  room.awaitingMrWhiteGuess = false;
  room.pendingWinner = undefined;
  room.lastElimination = undefined;

  const roleBag = [
    ...Array(room.settings.roleCounts.civil).fill('CIVIL'),
    ...Array(room.settings.roleCounts.undercover).fill('UNDERCOVER'),
    ...Array(room.settings.roleCounts.mrWhite).fill('MR_WHITE')
  ] as Array<'CIVIL' | 'UNDERCOVER' | 'MR_WHITE'>;

  const shuffledRoles = shuffle(roleBag, rng);
  const shuffledPlayers = shuffle(readyPlayers, rng);

  for (const player of room.players) {
    player.role = undefined;
    player.assignedWord = undefined;
    player.alive = false;
  }

  for (let i = 0; i < shuffledPlayers.length; i += 1) {
    const player = shuffledPlayers[i];
    const role = shuffledRoles[i];
    player.role = role;
    player.assignedWord = role === 'CIVIL' ? room.wordPair.a : role === 'UNDERCOVER' ? room.wordPair.b : null;
    player.alive = true;
  }

  room.alivePlayerIds = room.players.filter((player) => player.alive).map((player) => player.id);

  const assignedSecrets = room.players
    .filter((player) => player.alive)
    .map((player) => ({ playerId: player.id, secret: getPlayerSecret(player, room) }));

  return { assignedSecrets };
}

export function closeReveal(room: RoomRuntime, rng: () => number = Math.random): void {
  if (room.status !== 'REVEAL') {
    throw new Error('Reveal can only be closed from reveal phase.');
  }

  if (room.mode === 'LIVE') {
    room.revealAllowed = false;
  }

  room.status = 'CLUES';
  room.turnOrder = shuffle([...room.alivePlayerIds], rng);
  room.currentTurnIndex = 0;
  room.timeRemaining = room.settings.turnSeconds ?? undefined;
}

export function getCurrentSpeakerId(room: RoomRuntime): string | undefined {
  if (room.status !== 'CLUES') {
    return undefined;
  }
  return room.turnOrder[room.currentTurnIndex];
}

export function advanceTurn(room: RoomRuntime, rng: () => number = Math.random): void {
  if (room.status !== 'CLUES') {
    throw new Error('Turns can only advance in clues phase.');
  }

  const hasAnotherSpeaker = room.currentTurnIndex < room.turnOrder.length - 1;
  if (hasAnotherSpeaker) {
    room.currentTurnIndex += 1;
    room.timeRemaining = room.settings.turnSeconds ?? undefined;
    return;
  }

  room.status = 'VOTE';
  room.votes = {};
  room.timeRemaining = undefined;

  if (!room.settings.showVoteTally) {
    room.votes = {};
  }

  if (room.alivePlayerIds.length === 0) {
    room.pendingWinner = {
      winner: 'CIVILIANS',
      reason: 'No alive players remained.'
    };
    room.status = 'END';
  }

  if (room.turnOrder.length === 0 && room.alivePlayerIds.length > 0) {
    room.turnOrder = shuffle([...room.alivePlayerIds], rng);
    room.currentTurnIndex = 0;
  }
}

export function castVote(room: RoomRuntime, payload: { voterId: string; targetPlayerId: string }): { votesCast: number; votesTotal: number } {
  if (room.status !== 'VOTE') {
    throw new Error('Voting is only allowed during vote phase.');
  }
  if (!room.alivePlayerIds.includes(payload.voterId)) {
    throw new Error('Dead players cannot vote.');
  }
  if (!room.alivePlayerIds.includes(payload.targetPlayerId)) {
    throw new Error('Target must be alive.');
  }

  room.votes[payload.voterId] = payload.targetPlayerId;
  return computeVoteProgress(room);
}

export function resolveVotePhase(room: RoomRuntime, rng: () => number = Math.random): {
  elimination: { eliminatedPlayerId: string; revealedRole: 'CIVIL' | 'UNDERCOVER' | 'MR_WHITE' };
  awaitingGuess: boolean;
} {
  if (room.status !== 'VOTE') {
    throw new Error('Vote phase can only be resolved from vote status.');
  }

  const elimination = resolveVotes(room, rng);
  room.lastElimination = elimination;
  room.status = 'RESOLVE';
  room.votes = {};

  const eliminatedPlayer = room.players.find((player) => player.id === elimination.eliminatedPlayerId);
  if (!eliminatedPlayer) {
    throw new Error('Eliminated player missing.');
  }
  eliminatedPlayer.alive = false;
  room.alivePlayerIds = room.players.filter((player) => player.alive).map((player) => player.id);

  const immediateWinner = evaluateImmediateWinner(room, elimination);
  room.pendingWinner = immediateWinner;

  if (
    elimination.revealedRole === 'MR_WHITE' &&
    room.settings.winPreset === 'CLASSIC_GUESS' &&
    room.settings.mrWhiteCanGuessOnElim
  ) {
    room.awaitingMrWhiteGuess = true;
  } else {
    room.awaitingMrWhiteGuess = false;
  }

  return { elimination, awaitingGuess: room.awaitingMrWhiteGuess };
}

export function applyMrWhiteGuess(room: RoomRuntime, params: { playerId: string; guess: string }): { winner: Winner; reason: string } {
  if (room.status !== 'RESOLVE' || !room.awaitingMrWhiteGuess) {
    throw new Error('Mr White guess is not currently allowed.');
  }

  const player = room.players.find((entry) => entry.id === params.playerId);
  if (!player || player.role !== 'MR_WHITE') {
    throw new Error('Only the eliminated Mr White can guess.');
  }
  if (room.alivePlayerIds.includes(player.id)) {
    throw new Error('Only eliminated Mr White can guess.');
  }

  const normalizedGuess = params.guess.trim().toLowerCase();
  const normalizedTarget = room.wordPair.a.trim().toLowerCase();

  room.awaitingMrWhiteGuess = false;
  room.pendingWinner =
    normalizedGuess === normalizedTarget
      ? { winner: 'MR_WHITE_GUESS', reason: 'Mr White guessed the civilians word correctly.' }
      : { winner: 'CIVILIANS', reason: 'Mr White failed to guess the civilians word.' };

  return room.pendingWinner;
}

export function finalizeResolve(room: RoomRuntime, rng: () => number = Math.random):
  | { ended: true; winner: Winner; reason: string; wordPair: WordPair }
  | { ended: false } {
  if (room.status !== 'RESOLVE') {
    throw new Error('Can only finalize from resolve state.');
  }

  if (room.pendingWinner) {
    room.status = 'END';
    return {
      ended: true,
      winner: room.pendingWinner.winner,
      reason: room.pendingWinner.reason,
      wordPair: room.wordPair
    };
  }

  room.status = 'CLUES';
  room.roundNumber += 1;
  room.turnOrder = shuffle([...room.alivePlayerIds], rng);
  room.currentTurnIndex = 0;
  room.timeRemaining = room.settings.turnSeconds ?? undefined;
  return { ended: false };
}

export function resetRoom(room: RoomRuntime): void {
  room.status = 'LOBBY';
  room.roundNumber = 0;
  room.turnOrder = [];
  room.currentTurnIndex = 0;
  room.timeRemaining = undefined;
  room.votes = {};
  room.lastElimination = undefined;
  room.awaitingMrWhiteGuess = false;
  room.pendingWinner = undefined;
  room.revealAllowed = true;
  room.wordPair = DEFAULT_WORD_PAIR;
  room.wordSource = { type: 'RANDOM' };
  room.settings = structuredClone(DEFAULT_SETTINGS);

  room.players = room.players.filter((player) => player.connected || player.isHost);
  for (const player of room.players) {
    player.ready = player.isHost;
    player.role = undefined;
    player.assignedWord = undefined;
    player.alive = true;
  }
  room.alivePlayerIds = room.players.map((player) => player.id);
}

export function toPublicState(room: RoomRuntime): RoomPublicState {
  const aliveSet = new Set(room.alivePlayerIds);
  const playersPublic = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    ready: player.ready,
    alive: aliveSet.has(player.id),
    isHost: player.isHost
  }));

  const voteProgress = computeVoteProgress(room);

  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    playersPublic,
    roundNumber: room.roundNumber,
    currentSpeakerId: room.status === 'CLUES' ? getCurrentSpeakerId(room) : undefined,
    timeRemaining: room.status === 'CLUES' ? room.timeRemaining : undefined,
    votesCast: room.status === 'VOTE' || room.status === 'RESOLVE' ? voteProgress.votesCast : undefined,
    votesTotal: room.status === 'VOTE' || room.status === 'RESOLVE' ? voteProgress.votesTotal : undefined,
    lastElimination: room.lastElimination
  };
}

export function assertHost(room: RoomRuntime, playerId: string, hostKey?: string): void {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player || !player.isHost) {
    throw new Error('Only host can perform this action.');
  }
  if (!hostKey || hostKey !== room.hostKey) {
    throw new Error('Invalid host key.');
  }
}

export function getPlayerById(room: RoomRuntime, playerId: string): Player | undefined {
  return room.players.find((player) => player.id === playerId);
}

export function shouldAutoCloseVote(room: RoomRuntime): boolean {
  const progress = computeVoteProgress(room);
  return progress.votesCast >= progress.votesTotal && progress.votesTotal > 0;
}

export function hasConnectedNonHostPlayers(room: RoomRuntime): boolean {
  return room.players.some((player) => !player.isHost && player.connected);
}

export function getAliveCount(room: RoomRuntime): number {
  return getAlivePlayers(room).length;
}
