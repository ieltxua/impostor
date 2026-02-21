import type { Server } from 'socket.io';

import type { ClientToServerEvents, ServerError, ServerToClientEvents } from '@impostor/shared';

import {
  advanceTurn,
  applyMrWhiteGuess,
  assertHost,
  castVote,
  closeReveal,
  configureRoom,
  createRoom,
  createRoomCode,
  finalizeResolve,
  getCurrentSpeakerId,
  getPlayerById,
  getPlayerSecret,
  hasConnectedNonHostPlayers,
  joinAsPlayer,
  markPlayerDisconnected,
  normalizeRoomCode,
  resetRoom,
  resolveVotePhase,
  setPlayerReady,
  shouldAutoCloseVote,
  startGame,
  toPublicState
} from '../rooms/roomLogic.js';
import { computeVoteProgress } from '../rooms/transitions.js';
import { clearTurnTimer, deleteRoom, getRoom, listRooms, setRoom, startTurnTimer } from '../rooms/roomStore.js';
import { getPlayerFromSocket, getRoomFromSocket, type GameSocket } from './auth.js';

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
    timeRemaining: room.timeRemaining
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
}

function syncTurnTimer(io: Server<ClientToServerEvents, ServerToClientEvents>, roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) {
    clearTurnTimer(roomCode);
    return;
  }

  if (room.status !== 'CLUES' || room.settings.turnSeconds === null) {
    clearTurnTimer(room.code);
    return;
  }

  startTurnTimer(room.code, () => {
    const latestRoom = getRoom(room.code);
    if (!latestRoom || latestRoom.status !== 'CLUES') {
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
    return;
  }

  completeResolve(io, roomCode);
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
      markPlayerDisconnected(previousRoom, previousPlayer.id);
      if (previousPlayer.isHost) {
        io.to(previousRoom.code).emit('server:error', {
          code: 'HOST_DISCONNECTED',
          message: 'Host disconnected. Room closed.'
        });
        deleteRoom(previousRoom.code);
      } else {
        emitPublicState(io, previousRoom.code);
        if (previousRoom.status === 'VOTE' && shouldAutoCloseVote(previousRoom)) {
          resolveVotesAndBroadcast(io, previousRoom.code);
        }
      }
    }
  }

  socket.leave(previousRoomCode);
  socket.data.roomCode = undefined;
  socket.data.playerId = undefined;
  socket.data.isSpectator = false;
}

export function registerSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
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
          hostPlayerToken: payload.playerToken
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
            message: `Room ${roomCode} was not found.`
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

        emitPublicState(io, room.code);
        emitPhase(io, room.code);

        if (reconnected && player.role) {
          socket.emit('player:secret', getPlayerSecret(player, room));
          if (room.status === 'CLUES') {
            emitTurn(io, room.code);
          }
          if (room.status === 'VOTE') {
            emitVoteProgress(io, room.code);
          }
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
          message: `Room ${roomCode} was not found.`
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

        for (const assignment of assignedSecrets) {
          const recipient = getPlayerById(room, assignment.playerId);
          if (recipient?.connected) {
            io.to(recipient.socketId).emit('player:secret', assignment.secret);
          }
        }

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

    socket.on('turn:next', (payload) => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      try {
        assertHost(room, player.id, payload.hostKey);
        if (room.settings.turnSeconds !== null) {
          throw new Error('Manual next turn is only allowed when timer is disabled.');
        }
        advanceTurn(room);
        emitPhase(io, room.code);
        emitTurn(io, room.code);
        emitPublicState(io, room.code);
        if (room.status === 'VOTE') {
          emitVoteProgress(io, room.code);
        }
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to advance turn.'
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
        resolveVotesAndBroadcast(io, room.code);
      } catch (error) {
        emitError(socket, {
          code: 'INVALID_STATE',
          message: error instanceof Error ? error.message : 'Unable to close vote.'
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
        applyMrWhiteGuess(room, {
          playerId: player.id,
          guess: payload.guess
        });
        completeResolve(io, room.code);
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

    socket.on('disconnect', () => {
      const room = getRoomFromSocket(socket);
      const player = getPlayerFromSocket(socket);
      if (!room || !player) {
        return;
      }

      markPlayerDisconnected(room, player.id);

      if (player.isHost) {
        io.to(room.code).emit('server:error', {
          code: 'HOST_DISCONNECTED',
          message: 'Host disconnected. Room closed.'
        });
        deleteRoom(room.code);
        return;
      }

      if (room.status === 'VOTE' && shouldAutoCloseVote(room)) {
        resolveVotesAndBroadcast(io, room.code);
        return;
      }

      if (!hasConnectedNonHostPlayers(room) && !room.players.some((entry) => entry.isHost && entry.connected)) {
        deleteRoom(room.code);
        return;
      }

      emitPublicState(io, room.code);
    });
  });
}
