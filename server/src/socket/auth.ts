import type { Socket } from 'socket.io';

import type { ClientToServerEvents, ServerToClientEvents } from '@impostor/shared';

import { getRoom } from '../rooms/roomStore.js';
import { getPlayerById } from '../rooms/roomLogic.js';

export interface SocketSessionData {
  roomCode?: string;
  playerId?: string;
  isSpectator?: boolean;
}

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketSessionData>;

export function getRoomFromSocket(socket: GameSocket) {
  if (!socket.data.roomCode) {
    return undefined;
  }
  return getRoom(socket.data.roomCode);
}

export function getPlayerFromSocket(socket: GameSocket) {
  const room = getRoomFromSocket(socket);
  if (!room || !socket.data.playerId) {
    return undefined;
  }
  const player = getPlayerById(room, socket.data.playerId);
  if (!player) {
    return undefined;
  }
  if (player.socketId !== socket.id || !player.connected) {
    return undefined;
  }
  return player;
}
