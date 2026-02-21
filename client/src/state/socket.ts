import { io, type Socket } from 'socket.io-client';

import type { ClientToServerEvents, ServerToClientEvents } from '@impostor/shared';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | undefined;

function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:3000';
  }

  if (import.meta.env.DEV && window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  return window.location.origin;
}

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    const serverUrl = resolveServerUrl();
    socket = io(serverUrl, {
      autoConnect: true,
      transports: ['websocket']
    });
  }
  return socket;
}
