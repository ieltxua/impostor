import { randomBytes, randomUUID } from 'node:crypto';

import {
  DEFAULT_WORD_DECK,
  localizeWordPair,
  type Player,
  type PlayerSecret,
  type RoomPublicState,
  type RoleCounts,
  type WordLocale,
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
  turnSeconds: null,
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
    isLocalOnly: false,
    connected: true,
    lastSeenAt: Date.now(),
    ready: params.isHost,
    alive: true,
    socketId: params.socketId,
    playerToken: params.playerToken
  };
}

function isNameTaken(room: RoomRuntime, candidateName: string): boolean {
  const normalizedName = candidateName.trim().toLowerCase();
  return room.players.some((player) => player.name.trim().toLowerCase() === normalizedName);
}

function isNameTakenByOthers(room: RoomRuntime, playerId: string, candidateName: string): boolean {
  const normalizedName = candidateName.trim().toLowerCase();
  return room.players.some((player) => player.id !== playerId && player.name.trim().toLowerCase() === normalizedName);
}

export function createRoom(params: {
  code: string;
  mode: 'LIVE' | 'REMOTE';
  hostName: string;
  hostSocketId: string;
  hostPlayerToken?: string;
  wordLocale?: WordLocale;
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
    timerPaused: false,
    revealAllowed: true,
    revealAttemptCountsByPlayerId: {},
    votes: {},
    wordLocale: params.wordLocale ?? 'en',
    revealPlayerOrder: [],
    currentRevealPlayerIndex: 0,
    currentRevealPlayerId: undefined,
    emptySinceAt: undefined,
    pausedByIdle: false,
    idlePausedTimer: false,
    resumePromptRequired: false,
    resumeIdleMinutes: undefined,
    pendingHostTransferToPlayerId: undefined,
    hostKey: createHostKey(),
    wordSource: { type: 'RANDOM' },
    awaitingMrWhiteGuess: false
  };

  return { room, hostPlayer };
}

export function joinAsPlayer(room: RoomRuntime, params: { name: string; socketId: string; playerToken?: string }): { player: Player; reconnected: boolean } {
  const sameSocket = room.players.find((player) => player.socketId === params.socketId && player.connected);
  if (sameSocket) {
    sameSocket.lastSeenAt = Date.now();
    return { player: sameSocket, reconnected: true };
  }

  const token = params.playerToken?.trim();
  if (token) {
    const existing = room.players.find((player) => player.playerToken === token);
    if (existing) {
      existing.connected = true;
      existing.socketId = params.socketId;
      existing.lastSeenAt = Date.now();
      return { player: existing, reconnected: true };
    }
  }

  const normalizedName = params.name.trim().toLowerCase();
  const disconnectedByName = room.players.find(
    (player) =>
      !player.connected &&
      !player.isLocalOnly &&
      !player.isHost &&
      player.name.trim().toLowerCase() === normalizedName
  );
  if (disconnectedByName) {
    disconnectedByName.connected = true;
    disconnectedByName.socketId = params.socketId;
    disconnectedByName.lastSeenAt = Date.now();
    if (token) {
      disconnectedByName.playerToken = token;
    }
    return { player: disconnectedByName, reconnected: true };
  }

  if (room.status !== 'LOBBY') {
    throw new Error('Only previous participants can rejoin after game start.');
  }

  if (isNameTaken(room, params.name)) {
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

export function addLocalPlayer(room: RoomRuntime, params: { name: string }): Player {
  if (room.status !== 'LOBBY') {
    throw new Error('Local players can only be added in the lobby.');
  }
  if (!params.name.trim()) {
    throw new Error('Player name is required.');
  }

  if (isNameTaken(room, params.name)) {
    throw new Error('That name is already taken in this room.');
  }

  const player = createPlayer({
    name: params.name,
    isHost: false,
    socketId: `local-${randomUUID()}`
  });
  player.isLocalOnly = true;
  player.connected = false;
  player.ready = true;
  player.playerToken = undefined;

  room.players.push(player);
  room.alivePlayerIds = room.players.filter((entry) => entry.alive).map((entry) => entry.id);
  return player;
}

export function renameLocalPlayer(room: RoomRuntime, payload: { playerId: string; name: string }): void {
  if (room.status !== 'LOBBY') {
    throw new Error('Local players can only be renamed in the lobby.');
  }

  const normalizedName = payload.name.trim();
  if (!normalizedName) {
    throw new Error('Player name is required.');
  }

  const player = room.players.find((entry) => entry.id === payload.playerId);
  if (!player) {
    throw new Error('Player not found.');
  }
  if (!player.isLocalOnly || player.isHost) {
    throw new Error('Only local non-host players can be renamed.');
  }
  if (isNameTakenByOthers(room, player.id, normalizedName)) {
    throw new Error('That name is already taken in this room.');
  }

  player.name = normalizedName;
}

export function removeLocalPlayer(room: RoomRuntime, playerId: string): void {
  if (room.status !== 'LOBBY') {
    throw new Error('Local players can only be removed in the lobby.');
  }

  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error('Player not found.');
  }
  if (!player.isLocalOnly || player.isHost) {
    throw new Error('Only local non-host players can be removed.');
  }

  room.players = room.players.filter((entry) => entry.id !== playerId);
  delete room.votes[playerId];
  for (const voterId of Object.keys(room.votes)) {
    if (room.votes[voterId] === playerId) {
      delete room.votes[voterId];
    }
  }
  room.alivePlayerIds = room.players.filter((entry) => entry.alive).map((entry) => entry.id);
}

export function markPlayerDisconnected(room: RoomRuntime, playerId: string, expectedSocketId?: string): boolean {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) {
    return false;
  }
  if (expectedSocketId && player.socketId !== expectedSocketId) {
    return false;
  }

  player.connected = false;
  return true;
}

export function markPlayerSeen(room: RoomRuntime, playerId: string, socketId: string, now: number = Date.now()): boolean {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player || player.isLocalOnly || player.socketId !== socketId) {
    return false;
  }

  player.lastSeenAt = now;
  if (!player.connected) {
    player.connected = true;
  }
  return true;
}

export function sweepStalePresence(room: RoomRuntime, now: number, staleThresholdMs: number): Player[] {
  const stalePlayers: Player[] = [];
  for (const player of room.players) {
    if (!player.connected || player.isLocalOnly) {
      continue;
    }
    if (now - player.lastSeenAt <= staleThresholdMs) {
      continue;
    }
    player.connected = false;
    stalePlayers.push(player);
  }

  return stalePlayers;
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

export function queueHostTransfer(room: RoomRuntime, payload: { currentHostPlayerId: string; targetPlayerId: string }): void {
  const currentHost = room.players.find((entry) => entry.id === payload.currentHostPlayerId);
  if (!currentHost || !currentHost.isHost) {
    throw new Error('Only host can transfer host role.');
  }

  const target = room.players.find((entry) => entry.id === payload.targetPlayerId);
  if (!target) {
    throw new Error('Target player not found.');
  }
  if (target.isHost) {
    throw new Error('Target player is already host.');
  }
  if (target.isLocalOnly || !target.connected) {
    throw new Error('Host transfer target must be a connected device player.');
  }

  room.pendingHostTransferToPlayerId = target.id;
}

export function applyPendingHostTransfer(room: RoomRuntime): { changed: boolean; previousHostId?: string; nextHostId?: string } {
  const pendingTargetId = room.pendingHostTransferToPlayerId;
  if (!pendingTargetId) {
    return { changed: false };
  }

  const target = room.players.find((entry) => entry.id === pendingTargetId);
  if (!target || target.isLocalOnly || !target.connected) {
    room.pendingHostTransferToPlayerId = undefined;
    return { changed: false };
  }

  const previousHost = room.players.find((entry) => entry.isHost);
  if (!previousHost) {
    room.pendingHostTransferToPlayerId = undefined;
    return { changed: false };
  }
  if (previousHost.id === target.id) {
    room.pendingHostTransferToPlayerId = undefined;
    return { changed: false };
  }

  previousHost.isHost = false;
  target.isHost = true;
  target.ready = true;
  room.hostKey = createHostKey();
  room.pendingHostTransferToPlayerId = undefined;

  return {
    changed: true,
    previousHostId: previousHost.id,
    nextHostId: target.id
  };
}

function pickWordPair(source: WordSource, rng: () => number = Math.random): WordPair {
  if (source.type === 'CUSTOM') {
    return source.pair;
  }

  const selectedCategories =
    source.categories && source.categories.length > 0
      ? source.categories
      : source.category
        ? [source.category]
        : [];

  const normalizedCategories = new Set(selectedCategories.map((category) => category.trim().toLowerCase()).filter(Boolean));
  const deck =
    normalizedCategories.size > 0
      ? DEFAULT_WORD_DECK.filter((entry) => normalizedCategories.has(entry.category.toLowerCase()))
      : DEFAULT_WORD_DECK;
  const eligibleDeck = deck.length > 0 ? deck : DEFAULT_WORD_DECK;

  if (eligibleDeck.length === 0) {
    return DEFAULT_WORD_PAIR;
  }

  return eligibleDeck[Math.floor(rng() * eligibleDeck.length)];
}

function getCurrentRevealPlayerId(room: RoomRuntime): string | undefined {
  if (room.mode !== 'LIVE') {
    return undefined;
  }
  return room.revealPlayerOrder[room.currentRevealPlayerIndex];
}

function hasConnectedRemoteDevicePlayers(room: RoomRuntime): boolean {
  return room.players.some((player) => player.alive && player.connected && !player.isLocalOnly && !player.isHost);
}

function canRevealForPlayer(player: Player, room: RoomRuntime): boolean {
  const revealInProgress = room.status === 'REVEAL';
  if (!revealInProgress || !room.revealAllowed) {
    return false;
  }

  if (room.mode === 'REMOTE') {
    return room.settings.allowSecretReviewInRemote;
  }

  const hasLocalPlayers = room.players.some((entry) => entry.alive && entry.isLocalOnly);
  const isCurrentRevealPlayer = getCurrentRevealPlayerId(room) === player.id;
  const liveReveal = player.connected && !player.isLocalOnly;
  const mixedLocalAndRemote = hasLocalPlayers && hasConnectedRemoteDevicePlayers(room);

  if (mixedLocalAndRemote) {
    if (player.isLocalOnly) {
      return isCurrentRevealPlayer;
    }
    return player.connected;
  }

  if (hasLocalPlayers) {
    return liveReveal && isCurrentRevealPlayer;
  }

  return liveReveal;
}

export function getPlayerSecret(player: Player, room: RoomRuntime): PlayerSecret {
  return {
    role: player.role ?? 'CIVIL',
    wordOrNull: player.assignedWord ?? null,
    revealAllowed: canRevealForPlayer(player, room)
  };
}

function initializeRevealOrder(room: RoomRuntime, rng: () => number = Math.random): void {
  const hasLocalPlayers = room.players.some((player) => player.alive && player.isLocalOnly);
  const mixedLocalAndRemote = hasLocalPlayers && hasConnectedRemoteDevicePlayers(room);
  const candidates = mixedLocalAndRemote
    ? room.players.filter((player) => player.alive && (player.isLocalOnly || player.isHost))
    : room.players.filter((player) => player.alive && (player.connected || player.isLocalOnly));

  room.revealPlayerOrder = shuffle(candidates.map((player) => player.id), rng);
  room.currentRevealPlayerIndex = 0;
  room.currentRevealPlayerId = room.revealPlayerOrder[0];
}

function initializeRevealAttemptCounts(room: RoomRuntime): void {
  room.revealAttemptCountsByPlayerId = {};
  for (const player of room.alivePlayerIds) {
    room.revealAttemptCountsByPlayerId[player] = 0;
  }
}

function recordRevealAttempt(room: RoomRuntime, playerId?: string): void {
  if (!playerId) {
    return;
  }
  room.revealAttemptCountsByPlayerId[playerId] = (room.revealAttemptCountsByPlayerId[playerId] ?? 0) + 1;
}

function hasRevealAttempt(room: RoomRuntime, playerId?: string): boolean {
  if (!playerId) {
    return false;
  }
  return (room.revealAttemptCountsByPlayerId[playerId] ?? 0) > 0;
}

function getRevealPendingPlayerIds(room: RoomRuntime): string[] {
  return room.players
    .filter((player) => player.alive && (player.connected || player.isLocalOnly))
    .map((player) => player.id)
    .filter((playerId) => !hasRevealAttempt(room, playerId));
}

function validateRevealOpenTarget(room: RoomRuntime, player: Player): void {
  if (room.status !== 'REVEAL') {
    throw new Error('Reveal can only be tracked during reveal phase.');
  }
  if (!player.alive) {
    throw new Error('Only alive players can reveal secrets.');
  }

  const hasLocalPlayers = room.players.some((entry) => entry.alive && entry.isLocalOnly);
  if (room.mode !== 'LIVE') {
    if (!player.connected) {
      throw new Error('Only connected players can reveal in remote mode.');
    }
    return;
  }

  const mixedLocalAndRemote = hasLocalPlayers && hasConnectedRemoteDevicePlayers(room);
  if (mixedLocalAndRemote) {
    if (player.isLocalOnly || player.isHost) {
      if (room.currentRevealPlayerId !== player.id) {
        throw new Error('Only the active reveal player can be marked as revealed.');
      }
      return;
    }
    if (!player.connected) {
      throw new Error('Only connected players can reveal on their own device.');
    }
    return;
  }

  if (hasLocalPlayers && room.currentRevealPlayerId !== player.id) {
    throw new Error('Only the active reveal player can be marked as revealed.');
  }
  if (!hasLocalPlayers && !player.connected) {
    throw new Error('Only connected players can reveal on their own device.');
  }
}

export function markRevealOpened(room: RoomRuntime, playerId: string): void {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error('Player not found.');
  }
  validateRevealOpenTarget(room, player);
  recordRevealAttempt(room, playerId);
}

function countConfiguredRoles(settings: Settings): number {
  return settings.roleCounts.civil + settings.roleCounts.undercover + settings.roleCounts.mrWhite;
}

function normalizeRoleCounts(playerCount: number, counts: RoleCounts): RoleCounts {
  const maxMrWhite = Math.max(1, playerCount - 1);
  const mrWhite = Math.max(1, Math.min(Math.floor(counts.mrWhite || 0), maxMrWhite));
  const maxUndercover = Math.max(0, playerCount - mrWhite - 1);
  const undercover = Math.max(0, Math.min(Math.floor(counts.undercover || 0), maxUndercover));
  const civil = playerCount - mrWhite - undercover;

  return {
    civil,
    undercover,
    mrWhite
  };
}

export function startGame(room: RoomRuntime, rng: () => number = Math.random): { assignedSecrets: Array<{ playerId: string; secret: PlayerSecret }> } {
  if (room.status !== 'LOBBY') {
    throw new Error('Game can only start from lobby.');
  }

  const readyPlayers = room.players.filter((player) => (player.ready || player.isLocalOnly) && (player.connected || player.isLocalOnly));
  validateRoleCounts(readyPlayers.length, room.settings.roleCounts);
  if (room.settings.winPreset === 'CLASSIC_GUESS' && room.settings.mrWhiteCanGuessOnElim) {
    const hasReadyLocalPlayers = readyPlayers.some((player) => player.isLocalOnly);
    if (hasReadyLocalPlayers) {
      throw new Error('CLASSIC_GUESS with Mr White guess-on-elimination is not supported for local no-device players.');
    }
  }

  const selectedPair = pickWordPair(room.wordSource, rng);
  room.wordPair =
    room.wordSource.type === 'RANDOM' ? localizeWordPair(selectedPair, room.wordLocale) : selectedPair;
  room.revealAllowed = true;
  room.roundNumber = 1;
  room.status = 'REVEAL';
  room.turnOrder = [];
  room.currentTurnIndex = 0;
  room.timeRemaining = undefined;
  room.timerPaused = false;
  room.votes = {};
  room.awaitingMrWhiteGuess = false;
  room.pendingWinner = undefined;
  room.lastElimination = undefined;
  room.resumePromptRequired = false;
  room.resumeIdleMinutes = undefined;
  room.pausedByIdle = false;
  room.idlePausedTimer = false;

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
  initializeRevealAttemptCounts(room);

  if (room.mode === 'LIVE') {
    initializeRevealOrder(room, rng);
  } else {
    room.revealPlayerOrder = [];
    room.currentRevealPlayerIndex = 0;
    room.currentRevealPlayerId = undefined;
  }

  const assignedSecrets = room.players
    .filter((player) => player.alive)
    .map((player) => ({ playerId: player.id, secret: getPlayerSecret(player, room) }));

  return { assignedSecrets };
}

export function startNextWord(
  room: RoomRuntime,
  rng: () => number = Math.random
): {
  assignedSecrets: Array<{ playerId: string; secret: PlayerSecret }>;
  adjustedRoleCounts: boolean;
  hostTransfer?: { previousHostId: string; nextHostId: string; hostKey: string };
} {
  if (room.status === 'LOBBY') {
    throw new Error('Next word can only start after the game has started.');
  }

  const activePlayers = room.players.filter((player) => player.isHost || player.isLocalOnly || player.connected);
  if (activePlayers.length < 2) {
    throw new Error('At least 2 active players are required to continue with next word.');
  }

  const activePlayerIds = new Set(activePlayers.map((player) => player.id));
  for (const player of room.players) {
    player.ready = activePlayerIds.has(player.id);
  }

  let adjustedRoleCounts = false;
  if (countConfiguredRoles(room.settings) !== activePlayers.length) {
    room.settings = {
      ...room.settings,
      roleCounts: normalizeRoleCounts(activePlayers.length, room.settings.roleCounts)
    };
    adjustedRoleCounts = true;
  }

  if (room.settings.winPreset === 'CLASSIC_GUESS' && room.settings.mrWhiteCanGuessOnElim && activePlayers.some((player) => player.isLocalOnly)) {
    room.settings = {
      ...room.settings,
      mrWhiteCanGuessOnElim: false
    };
  }

  room.status = 'LOBBY';
  room.votes = {};
  room.lastElimination = undefined;
  room.awaitingMrWhiteGuess = false;
  room.pendingWinner = undefined;
  room.turnOrder = [];
  room.currentTurnIndex = 0;
  room.timeRemaining = undefined;
  room.timerPaused = false;
  room.revealAllowed = true;
  room.resumePromptRequired = false;
  room.resumeIdleMinutes = undefined;
  room.pausedByIdle = false;
  room.idlePausedTimer = false;

  const hostTransfer = applyPendingHostTransfer(room);
  if (hostTransfer.changed) {
    for (const player of room.players) {
      if (player.id === hostTransfer.nextHostId) {
        player.ready = true;
      }
    }
  }

  const next = startGame(room, rng);
  return {
    ...next,
    adjustedRoleCounts,
    hostTransfer:
      hostTransfer.changed && hostTransfer.previousHostId && hostTransfer.nextHostId
        ? {
            previousHostId: hostTransfer.previousHostId,
            nextHostId: hostTransfer.nextHostId,
            hostKey: room.hostKey
          }
        : undefined
  };
}

export function closeReveal(room: RoomRuntime, rng: () => number = Math.random): void {
  if (room.status !== 'REVEAL') {
    throw new Error('Reveal can only be closed from reveal phase.');
  }
  const pendingRevealPlayerIds = getRevealPendingPlayerIds(room);
  if (pendingRevealPlayerIds.length > 0) {
    throw new Error(
      `All players must reveal at least once before continuing. Pending ${pendingRevealPlayerIds.length} player(s).`
    );
  }

  if (room.mode === 'LIVE') {
    room.revealAllowed = false;
  }

  room.status = 'CLUES';
  room.currentRevealPlayerId = undefined;
  room.currentRevealPlayerIndex = 0;
  room.revealPlayerOrder = [];
  room.turnOrder = shuffle([...room.alivePlayerIds], rng);
  room.currentTurnIndex = 0;
  room.timeRemaining = room.settings.turnSeconds ?? undefined;
  room.timerPaused = false;
}

export function nextReveal(room: RoomRuntime): { currentRevealPlayerId?: string; nextRevealPlayerId?: string } {
  if (room.status !== 'REVEAL') {
    throw new Error('Reveal can only be advanced in reveal phase.');
  }
  if (room.mode !== 'LIVE') {
    throw new Error('Sequential reveal is only available in LIVE mode.');
  }
  if (!hasRevealAttempt(room, room.currentRevealPlayerId)) {
    throw new Error('Current reveal player must open secret at least once before moving on.');
  }
  if (room.currentRevealPlayerIndex >= room.revealPlayerOrder.length - 1) {
    throw new Error('No further players to reveal.');
  }
  room.currentRevealPlayerIndex += 1;
  room.currentRevealPlayerId = room.revealPlayerOrder[room.currentRevealPlayerIndex];
  return {
    currentRevealPlayerId: room.currentRevealPlayerId,
    nextRevealPlayerId: room.revealPlayerOrder[room.currentRevealPlayerIndex + 1]
  };
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
    room.timerPaused = false;
    return;
  }

  room.status = 'VOTE';
  room.votes = {};
  room.timeRemaining = undefined;
  room.timerPaused = false;

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
    room.settings.mrWhiteCanGuessOnElim &&
    !room.pendingWinner
  ) {
    room.awaitingMrWhiteGuess = true;
  } else {
    room.awaitingMrWhiteGuess = false;
  }

  return { elimination, awaitingGuess: room.awaitingMrWhiteGuess };
}

export function canAdvanceResolve(room: RoomRuntime): boolean {
  return room.status === 'RESOLVE' && !room.awaitingMrWhiteGuess;
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
  room.timerPaused = false;
  return { ended: false };
}

export function pauseClueTimer(room: RoomRuntime): void {
  if (room.status !== 'CLUES' || room.settings.turnSeconds === null) {
    throw new Error('Timer can only be paused during timed clues.');
  }
  room.timerPaused = true;
}

export function resumeClueTimer(room: RoomRuntime): void {
  if (room.status !== 'CLUES' || room.settings.turnSeconds === null) {
    throw new Error('Timer can only be resumed during timed clues.');
  }
  room.timerPaused = false;
}

export function resetRoom(room: RoomRuntime): void {
  room.status = 'LOBBY';
  room.roundNumber = 0;
  room.turnOrder = [];
  room.currentTurnIndex = 0;
  room.timeRemaining = undefined;
  room.timerPaused = false;
  room.votes = {};
  room.lastElimination = undefined;
  room.awaitingMrWhiteGuess = false;
  room.pendingWinner = undefined;
  room.revealAllowed = true;
  room.revealPlayerOrder = [];
  room.currentRevealPlayerIndex = 0;
  room.currentRevealPlayerId = undefined;
  room.resumePromptRequired = false;
  room.resumeIdleMinutes = undefined;
  room.pausedByIdle = false;
  room.idlePausedTimer = false;
  room.emptySinceAt = undefined;
  room.pendingHostTransferToPlayerId = undefined;
  room.wordPair = DEFAULT_WORD_PAIR;
  room.wordSource = { type: 'RANDOM' };
  room.settings = structuredClone(DEFAULT_SETTINGS);
  room.revealAttemptCountsByPlayerId = {};

  room.players = room.players.filter((player) => player.connected || player.isHost || player.isLocalOnly);
  for (const player of room.players) {
    player.ready = player.isHost || player.isLocalOnly;
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
    connected: player.connected || player.isLocalOnly,
    ready: player.ready,
    alive: aliveSet.has(player.id),
    isHost: player.isHost,
    isLocalOnly: player.isLocalOnly
  }));

  const voteProgress = computeVoteProgress(room);
  const votedPlayerIds =
    room.status === 'VOTE' || room.status === 'RESOLVE'
      ? Object.keys(room.votes).filter((playerId) => aliveSet.has(playerId))
      : undefined;

  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    playersPublic,
    roundNumber: room.roundNumber,
    currentSpeakerId: room.status === 'CLUES' ? getCurrentSpeakerId(room) : undefined,
    currentRevealPlayerId: room.status === 'REVEAL' ? room.currentRevealPlayerId : undefined,
    revealAttemptCountsByPlayerId:
      room.status === 'REVEAL' && Object.keys(room.revealAttemptCountsByPlayerId).length > 0
        ? room.revealAttemptCountsByPlayerId
        : undefined,
    nextRevealPlayerId:
      room.status === 'REVEAL' && room.currentRevealPlayerIndex + 1 < room.revealPlayerOrder.length
        ? room.revealPlayerOrder[room.currentRevealPlayerIndex + 1]
        : undefined,
    timeRemaining: room.status === 'CLUES' ? room.timeRemaining : undefined,
    timerPaused: room.status === 'CLUES' ? room.timerPaused : undefined,
    votesCast: room.status === 'VOTE' || room.status === 'RESOLVE' ? voteProgress.votesCast : undefined,
    votesTotal: room.status === 'VOTE' || room.status === 'RESOLVE' ? voteProgress.votesTotal : undefined,
    votedPlayerIds,
    lastElimination: room.lastElimination,
    resolveOutcome: room.pendingWinner
      ? {
          winner: room.pendingWinner.winner,
          reason: room.pendingWinner.reason
        }
      : undefined,
    resumePromptRequired: room.resumePromptRequired ? true : undefined,
    resumeIdleMinutes: room.resumePromptRequired ? room.resumeIdleMinutes : undefined,
    pendingHostTransferToPlayerId: room.pendingHostTransferToPlayerId
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
