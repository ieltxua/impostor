import type { Server } from 'socket.io';

import type { ClientToServerEvents, ServerError, ServerToClientEvents } from '@impostor/shared';

import {
  addLocalPlayer,
  advanceTurn,
  applyMrWhiteGuess,
  assertHost,
  castVote,
  closeReveal,
  configureRoom,
  createRoom,
  createRoomCode,
  queueHostTransfer,
  nextReveal,
  markRevealOpened,
  renameLocalPlayer,
  finalizeResolve,
  canAdvanceResolve,
  pauseClueTimer,
  getCurrentSpeakerId,
  getPlayerById,
  getPlayerSecret,
  joinAsPlayer,
  markPlayerDisconnected,
  markPlayerSeen,
  normalizeRoomCode,
  removeLocalPlayer,
  resetRoom,
  resolveVotePhase,
  setPlayerReady,
  shouldAutoCloseVote,
  resumeClueTimer,
  startGame,
  startNextWord,
  sweepStalePresence,
  toPublicState
} from '../rooms/roomLogic.js';
import { computeVoteProgress } from '../rooms/transitions.js';
import { clearTurnTimer, deleteRoom, getRoom, listRooms, setRoom, startTurnTimer, type RoomRuntime } from '../rooms/roomStore.js';
import { getPlayerFromSocket, getRoomFromSocket, type GameSocket } from './auth.js';

const PRESENCE_STALE_MS = 25_000;
const PRESENCE_SWEEP_INTERVAL_MS = 5_000;
const EMPTY_ROOM_TTL_MS = 60 * 60 * 1000;
const RESUME_PROMPT_IDLE_MS = 10 * 60 * 1000;

function hasConnectedPlayers(room: RoomRuntime): boolean {
  return room.players.some((player) => player.connected);
}

function markRoomIdleIfNeeded(room: RoomRuntime, now: number = Date.now()): void {
  if (hasConnectedPlayers(room)) {
    room.emptySinceAt = undefined;
    return;
  }

  if (!room.emptySinceAt) {
    room.emptySinceAt = now;
  }

  if (room.status === 'LOBBY') {
    return;
  }

  room.pausedByIdle = true;
  if (room.status === 'CLUES' && room.settings.turnSeconds !== null && !room.timerPaused) {
    room.timerPaused = true;
    room.idlePausedTimer = true;
    clearTurnTimer(room.code);
  }
}

function clearRoomIdlePause(room: RoomRuntime): void {
  room.resumePromptRequired = false;
  room.resumeIdleMinutes = undefined;
  room.pausedByIdle = false;
  if (room.status === 'CLUES' && room.settings.turnSeconds !== null && room.idlePausedTimer) {
    room.timerPaused = false;
  }
  room.idlePausedTimer = false;
}

function restoreRoomAfterReconnect(room: RoomRuntime, now: number = Date.now()): void {
  if (!room.emptySinceAt) {
    return;
  }

  const idleMs = Math.max(0, now - room.emptySinceAt);
  room.emptySinceAt = undefined;

  const shouldRequireHostResume = room.status !== 'LOBBY' && idleMs >= RESUME_PROMPT_IDLE_MS;
  if (!shouldRequireHostResume) {
    clearRoomIdlePause(room);
    return;
  }

  room.resumePromptRequired = true;
  room.resumeIdleMinutes = Math.max(10, Math.floor(idleMs / 60_000));
  room.pausedByIdle = true;
  if (room.status === 'CLUES' && room.settings.turnSeconds !== null) {
    room.timerPaused = true;
    clearTurnTimer(room.code);
  }
}

function assertRoomNotPausedForResume(room: RoomRuntime): void {
  if (room.resumePromptRequired) {
    throw new Error('Room paused after inactivity. Host must continue or close the room.');
  }
}

function safeDeleteRoom(roomCode: string): void {
  deleteRoom(roomCode);
}

function sweepRoomPresence(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
  const now = Date.now();
  for (const room of listRooms()) {
    const stalePlayers = sweepStalePresence(room, now, PRESENCE_STALE_MS);

    if (stalePlayers.some((player) => player.isHost)) {
      io.to(room.code).emit('server:error', {
        code: 'HOST_DISCONNECTED_TEMPORARY',
        message: 'Host disconnected. Waiting for reconnection.'
      });
    }

    markRoomIdleIfNeeded(room, now);
    if (room.emptySinceAt && now - room.emptySinceAt >= EMPTY_ROOM_TTL_MS) {
      safeDeleteRoom(room.code);
      continue;
    }

    if (room.status === 'VOTE' && shouldAutoCloseVote(room)) {
      resolveVotesAndBroadcast(io, room.code);
      continue;
    }

    if (stalePlayers.length > 0) {
      emitPublicState(io, room.code);
    }
  }
}

function emitError(socket: GameSocket, payload: ServerError): void {
  socket.emit('server:error', payload);
}

function emitPublicState(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }
  io.to(room.code).emit('room:state_public', { roomPublicState: toPublicState(room) });
}

function emitPhase(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }
  io.to(room.code).emit('phase:update', { status: room.status });
}

function emitTurn(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }
  io.to(room.code).emit('turn:update', {
    currentSpeakerId: getCurrentSpeakerId(room),
    timeRemaining: room.timeRemaining,
    timerPaused: room.timerPaused
  });
}

function emitVoteProgress(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room || room.status !== 'VOTE') {
    return;
  }
  const { votesCast, votesTotal } = computeVoteProgress(room);
  io.to(room.code).emit('vote:update', {
    votesCast,
    votesTotal
  });
  emitVoteStateToConnectedPlayers(io, roomCode);
}

function emitVoteStateToConnectedPlayers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  roomCode: string
): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }
  for (const player of room.players) {
    if (!player.connected) {
      continue;
    }
    io.to(player.socketId).emit('vote:state', {
      targetPlayerId: room.status === 'VOTE' ? room.votes[player.id] : undefined
    });
  }
}

function syncTurnTimer(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    clearTurnTimer(roomCode);
    return;
  }

  if (room.status !== 'CLUES' || room.settings.turnSeconds === null || room.timerPaused) {
    clearTurnTimer(room.code);
    return;
  }

  startTurnTimer(room.code, () => {
    const latestRoom = getRoom(room.code);
    if (!latestRoom || latestRoom.status !== 'CLUES') {
      clearTurnTimer(room.code);
      return;
    }
    if (latestRoom.timerPaused) {
      clearTurnTimer(room.code);
      return;
    }

    if ((latestRoom.timeRemaining ?? 0) <= 1) {
      advanceTurn(latestRoom);
      const updatedRoom = getRoom(latestRoom.code);
      if (!updatedRoom) {
        clearTurnTimer(latestRoom.code);
        return;
      }
      emitPhase(io, latestRoom.code);
      emitTurn(io, latestRoom.code);
      emitPublicState(io, latestRoom.code);

      if (updatedRoom.status === 'VOTE') {
        emitVoteProgress(io, updatedRoom.code);
        clearTurnTimer(updatedRoom.code);
      } else {
        syncTurnTimer(io, updatedRoom.code);
      }
      return;
    }

    latestRoom.timeRemaining = (latestRoom.timeRemaining ?? latestRoom.settings.turnSeconds ?? 0) - 1;
    emitTurn(io, latestRoom.code);
    emitPublicState(io, latestRoom.code);
  });
}

function completeResolve(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }

  const result = finalizeResolve(room);
  if (result.ended) {
    io.to(room.code).emit('game:end', {
      winner: result.winner,
      reason: result.reason,
      wordPair: result.wordPair
    });
    emitPhase(io, room.code);
    emitPublicState(io, room.code);
    clearTurnTimer(room.code);
    return;
  }

  emitPhase(io, room.code);
  emitTurn(io, room.code);
  emitPublicState(io, room.code);
  syncTurnTimer(io, room.code);
}

function continueToNextWord(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  room: NonNullable<ReturnType<typeof getRoom>>
): void {
  const startResult = startNextWord(room);
  if (startResult.hostTransfer) {
    const nextHost = getPlayerById(room, startResult.hostTransfer.nextHostId);
    if (nextHost?.connected) {
      io.to(nextHost.socketId).emit('host:granted', { hostKey: startResult.hostTransfer.hostKey });
    }
  }
  emitRevealAssignments(
    io,
    room.code,
    startResult.assignedSecrets
  );

  emitPhase(io, room.code);
  emitPublicState(io, room.code);
  syncTurnTimer(io, room.code);
}

function resolveVotesAndBroadcast(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }

  const result = resolveVotePhase(room);

  io.to(room.code).emit('resolve:elimination', result.elimination);
  emitPhase(io, room.code);
  emitPublicState(io, room.code);

  if (result.awaitingGuess) {
    const eliminatedMrWhite = room.players.find((player) => player.id === result.elimination.eliminatedPlayerId);
    if (eliminatedMrWhite) {
      io.to(eliminatedMrWhite.socketId).emit('mrwhite:guess_prompt', {
        maskedWordHintLength: room.wordPair.a.length
      });
    }
  }
}

function detachSocketSession(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: GameSocket,
  nextRoomCode?: string
): void {
  const previousRoomCode = socket.data.roomCode;
  const previousPlayerId = socket.data.playerId;

  if (!previousRoomCode) {
    return;
  }
  if (nextRoomCode && previousRoomCode === nextRoomCode) {
    return;
  }

  const previousRoom = getRoom(previousRoomCode);
  if (previousRoom && previousPlayerId) {
    const previousPlayer = getPlayerById(previousRoom, previousPlayerId);
    if (previousPlayer) {
      const disconnected = markPlayerDisconnected(previousRoom, previousPlayer.id, socket.id);
      if (!disconnected) {
        socket.leave(previousRoomCode);
        socket.data.roomCode = undefined;
        socket.data.playerId = undefined;
        socket.data.isSpectator = false;
        return;
      }

      if (previousPlayer.isHost) {
        io.to(previousRoom.code).emit('server:error', {
          code: 'HOST_DISCONNECTED_TEMPORARY',
          message: 'Host disconnected. Waiting for reconnection.'
        });
      }

      markRoomIdleIfNeeded(previousRoom);
      emitPublicState(io, previousRoom.code);
      if (previousRoom.status === 'VOTE' && shouldAutoCloseVote(previousRoom)) {
        resolveVotesAndBroadcast(io, previousRoom.code);
      }
    }
  }

  socket.leave(previousRoomCode);
  socket.data.roomCode = undefined;
  socket.data.playerId = undefined;
  socket.data.isSpectator = false;
}

function emitRevealAssignments(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  roomCode: string,
  assignments: Array<{ playerId: string; secret: ReturnType<typeof getPlayerSecret> }>
): void {
  const room = getRoom(roomCode);
  if (!room) {
    return;
  }

  for (const assignment of assignments) {
    const recipient = getPlayerById(room, assignment.playerId);
    if (!recipient?.connected) {
      continue;
    }
    io.to(recipient.socketId).emit('player:secret', {
      playerId: assignment.playerId,
      secret: assignment.secret
    });
  }
}

export function registerSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
  const presenceSweepTimer = setInterval(() => {
    sweepRoomPresence(io);
  }, PRESENCE_SWEEP_INTERVAL_MS);
  if (typeof (presenceSweepTimer as NodeJS.Timeout).unref === 'function') {
    (presenceSweepTimer as NodeJS.Timeout).unref();
  }
  io.engine.on('close', () => {
    clearInterval(presenceSweepTimer);
  });

  io.on('connection', (socket) => {
    socket.on('room:create', (payload) => {
      try {
        detachSocketSession(io, socket);
        const roomCode = createRoomCode(new Set(listRooms().map((room) => room.code)));
        const { room, hostPlayer } = createRoom({
          code: roomCode,
          mode: payload.mode,
          hostName: payload.name,
          hostSocketId: socket.id,
          hostPlayerToken: payload.playerToken,
          wordLocale: payload.wordLocale
        });
        setRoom(room);

        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.playerId = hostPlayer.id;
        socket.data.isSpectator = false;

        socket.emit('room:created', {
          roomCode: room.code,
          hostKey: room.hostKey,
          playerId: hostPlayer.id
        });

        emitPublicState(io, room.code);
        emitPhase(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_PAYLOAD',
          message: error instanceof Error ? error.message : 'Failed to create room.'
        });
      }
    });

    socket.on('room:join', (payload) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode);
        detachSocketSession(io, socket, roomCode);
        const room = getRoom(roomCode);
        if (!room) {
          emitError(socket, {
            code: 'ROOM_NOT_FOUND',
            message: `Room ${roomCode} was not found.`,
            roomCode
          });
          return;
        }
        if (room.emptySinceAt && Date.now() - room.emptySinceAt >= EMPTY_ROOM_TTL_MS) {
          safeDeleteRoom(room.code);
          emitError(socket, {
            code: 'ROOM_NOT_FOUND',
            message: `Room ${roomCode} expired due to inactivity.`,
            roomCode
          });
          return;
        }

        const { player, reconnected } = joinAsPlayer(room, {
          name: payload.name,
          socketId: socket.id,
          playerToken: payload.playerToken
        });

        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        socket.data.isSpectator = false;

        socket.emit('room:joined', {
          roomCode: room.code,
          playerId: player.id,
          isHost: player.isHost,
          hostKey: player.isHost ? room.hostKey : undefined
        });

        restoreRoomAfterReconnect(room);

        emitPublicState(io, room.code);
        emitPhase(io, room.code);
        if (room.status === 'CLUES') {
          emitTurn(io, room.code);
          if (!room.resumePromptRequired) {
            syncTurnTimer(io, room.code);
          }
        }
        if (room.status === 'VOTE') {
          emitVoteProgress(io, room.code);
        }

        if (reconnected && player.role) {
          socket.emit('player:secret', {
            playerId: player.id,
            secret: getPlayerSecret(player, room)
          });
          if (room.status === 'RESOLVE' && room.awaitingMrWhiteGuess && player.role === 'MR_WHITE' && !player.alive) {
            socket.emit('mrwhite:guess_prompt', {
              maskedWordHintLength: room.wordPair.a.length
            });
          }
        }
      } catch (error) {
        emitError(socket, {
          code: error instanceof Error && error.message.includes('taken') ? 'NAME_TAKEN' : 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Failed to join room.'
        });
      }
    });

    socket.on('room:watch', (payload) => {
      const roomCode = normalizeRoomCode(payload.roomCode);
      detachSocketSession(io, socket, roomCode);
      const room = getRoom(roomCode);
      if (!room) {
        emitError(socket, {
          code: 'ROOM_NOT_FOUND',
          message: `Room ${roomCode} was not found.`,
          roomCode
        });
        return;
      }

      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.isSpectator = true;
      socket.data.playerId = undefined;

      emitPublicState(io, room.code);
      emitPhase(io, room.code);
      emitTurn(io, room.code);
      emitVoteProgress(io, room.code);
    });

    socket.on('presence:heartbeat', () => {
      const room = getRoomFromSocket(socket);
      const playerId = socket.data.playerId;
      if (!room || !playerId || socket.data.isSpectator) {
        return;
      }

      const player = getPlayerById(room, playerId);
      if (!player) {
        return;
      }
      const wasConnected = player.connected;
      const marked = markPlayerSeen(room, playerId, socket.id);
      if (!marked) {
        return;
      }

      if (!wasConnected) {
        restoreRoomAfterReconnect(room);
        emitPublicState(io, room.code);
        if (room.status === 'CLUES' && !room.resumePromptRequired) {
          emitTurn(io, room.code);
          syncTurnTimer(io, room.code);
        }
      }
    });

    socket.on('room:ready', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        setPlayerReady(room, player.id, payload.ready);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Failed to update ready state.'
        });
      }
    });

    socket.on('reveal:opened', () => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertRoomNotPausedForResume(room);
        markRevealOpened(room, player.id);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to track reveal.'
        });
      }
    });

    socket.on('host:addLocalPlayer', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        addLocalPlayer(room, { name: payload.name });
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: error instanceof Error && error.message.toLowerCase().includes('taken') ? 'NAME_TAKEN' : 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to add local player.'
        });
      }
    });

    socket.on('host:removeLocalPlayer', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        removeLocalPlayer(room, payload.playerId);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to remove local player.'
        });
      }
    });

    socket.on('host:renameLocalPlayer', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        renameLocalPlayer(room, payload);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to rename local player.'
        });
      }
    });

    socket.on('host:configure', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        configureRoom(room, payload);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'UNAUTHORIZED',
          message: error instanceof Error ? error.message : 'Only host can configure room.'
        });
      }
    });

    socket.on('host:start', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        const { assignedSecrets } = startGame(room);
        emitRevealAssignments(io, room.code, assignedSecrets);

        emitPhase(io, room.code);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to start game.'
        });
      }
    });

    socket.on('host:closeReveal', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        closeReveal(room);
        emitPhase(io, room.code);
        emitTurn(io, room.code);
        emitPublicState(io, room.code);
        syncTurnTimer(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to close reveal.'
        });
      }
    });

    socket.on('host:nextReveal', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        nextReveal(room);
        emitRevealAssignments(
          io,
          room.code,
          room.players
            .filter((entry) => entry.connected || entry.isLocalOnly)
            .map((entry) => ({
              playerId: entry.id,
              secret: getPlayerSecret(entry, room)
            }))
        );

        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to advance reveal.'
        });
      }
    });

    socket.on('turn:next', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        advanceTurn(room);
        emitPhase(io, room.code);
        emitTurn(io, room.code);
        emitPublicState(io, room.code);
        if (room.status === 'VOTE') {
          emitVoteProgress(io, room.code);
        } else {
          syncTurnTimer(io, room.code);
        }
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to advance turn.'
        });
      }
    });

    socket.on('host:pauseTimer', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        pauseClueTimer(room);
        clearTurnTimer(room.code);
        emitTurn(io, room.code);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to pause timer.'
        });
      }
    });

    socket.on('host:resumeTimer', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        resumeClueTimer(room);
        emitTurn(io, room.code);
        emitPublicState(io, room.code);
        syncTurnTimer(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to resume timer.'
        });
      }
    });

    socket.on('vote:cast', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertRoomNotPausedForResume(room);
        castVote(room, {
          voterId: player.id,
          targetPlayerId: payload.targetPlayerId
        });

        emitVoteProgress(io, room.code);
        emitPublicState(io, room.code);

        if (shouldAutoCloseVote(room)) {
          resolveVotesAndBroadcast(io, room.code);
        }
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to cast vote.'
        });
      }
    });

    socket.on('vote:close', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        resolveVotesAndBroadcast(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to close vote.'
        });
      }
    });

    socket.on('host:advanceResolve', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        if (!canAdvanceResolve(room)) {
          throw new Error('Resolve stage is not ready to advance.');
        }

        completeResolve(io, room.code);

        if (!payload.startNextWord) {
          return;
        }

        clearTurnTimer(room.code);
        continueToNextWord(io, room);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to advance resolve.'
        });
      }
    });

    socket.on('host:voteForPlayer', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        const voter = getPlayerById(room, payload.voterPlayerId);
        if (!voter) {
          throw new Error('Voter player was not found.');
        }

        castVote(room, {
          voterId: payload.voterPlayerId,
          targetPlayerId: payload.targetPlayerId
        });

        emitVoteProgress(io, room.code);
        emitPublicState(io, room.code);

        if (shouldAutoCloseVote(room)) {
          resolveVotesAndBroadcast(io, room.code);
        }
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to cast host-managed vote.'
        });
      }
    });

    socket.on('host:nextWord', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        clearTurnTimer(room.code);
        const { assignedSecrets, hostTransfer } = startNextWord(room);
        if (hostTransfer) {
          const nextHost = getPlayerById(room, hostTransfer.nextHostId);
          if (nextHost?.connected) {
            io.to(nextHost.socketId).emit('host:granted', { hostKey: hostTransfer.hostKey });
          }
        }
        emitRevealAssignments(io, room.code, assignedSecrets);

        emitPhase(io, room.code);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to continue with next word.'
        });
      }
    });

    socket.on('host:resumeAfterIdle', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        if (!room.resumePromptRequired) {
          return;
        }

        clearRoomIdlePause(room);
        emitPublicState(io, room.code);
        if (room.status === 'CLUES') {
          emitTurn(io, room.code);
          syncTurnTimer(io, room.code);
        }
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to continue room after idle pause.'
        });
      }
    });

    socket.on('host:transferHost', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        queueHostTransfer(room, {
          currentHostPlayerId: player.id,
          targetPlayerId: payload.targetPlayerId
        });
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to schedule host transfer.'
        });
      }
    });

    socket.on('host:requestLocalSecret', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        const localPlayer = getPlayerById(room, payload.playerId);
        if (!localPlayer || !localPlayer.isLocalOnly) {
          throw new Error('Local player not found.');
        }
        if (room.mode === 'LIVE' && room.status === 'REVEAL' && room.currentRevealPlayerId !== localPlayer.id) {
          throw new Error('Only the active local reveal player can be requested in LIVE mode.');
        }
        if (!localPlayer.role) {
          throw new Error('Secrets are only available after game start.');
        }

        socket.emit('host:localSecret', {
          playerId: localPlayer.id,
          playerName: localPlayer.name,
          secret: {
            role: localPlayer.role,
            wordOrNull: localPlayer.assignedWord ?? null,
            revealAllowed: true
          }
        });
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to load local player secret.'
        });
      }
    });

    socket.on('host:markRevealOpened', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        assertRoomNotPausedForResume(room);
        markRevealOpened(room, payload.playerId);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to track host-managed reveal.'
        });
      }
    });

    socket.on('mrwhite:guess', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertRoomNotPausedForResume(room);
        applyMrWhiteGuess(room, {
          playerId: player.id,
          guess: payload.guess
        });
        emitPhase(io, room.code);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to process Mr White guess.'
        });
      }
    });

    socket.on('host:resetRoom', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        clearTurnTimer(room.code);
        resetRoom(room);
        emitPhase(io, room.code);
        emitPublicState(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to reset room.'
        });
      }
    });

    socket.on('host:closeRoom', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        socket.to(room.code).emit('server:error', {
          code: 'HOST_DISCONNECTED',
          message: 'Host closed room.'
        });
        clearTurnTimer(room.code);
        safeDeleteRoom(room.code);
        socket.leave(room.code);
        socket.data.roomCode = undefined;
        socket.data.playerId = undefined;
        socket.data.isSpectator = false;
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to close room.'
        });
      }
    });

    socket.on('disconnect', () => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      const disconnected = markPlayerDisconnected(room, player.id, socket.id);
      if (!disconnected) {
        return;
      }

      if (player.isHost) {
        io.to(room.code).emit('server:error', {
          code: 'HOST_DISCONNECTED_TEMPORARY',
          message: 'Host disconnected. Waiting for reconnection.'
        });
      }

      if (room.status === 'VOTE' && shouldAutoCloseVote(room)) {
        resolveVotesAndBroadcast(io, room.code);
        return;
      }

      markRoomIdleIfNeeded(room);
      emitPublicState(io, room.code);
    });
  });
}
