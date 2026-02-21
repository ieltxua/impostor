import http from 'node:http';

import express from 'express';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ClientToServerEvents,
  GameEndPayload,
  PlayerSecret,
  RoomJoinedPayload,
  RoomPublicState,
  ServerToClientEvents,
  Settings
} from '@impostor/shared';

import { resetRoomStore } from '../rooms/roomStore.js';
import { registerSocketHandlers } from './handlers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface TestClient {
  name: string;
  token: string;
  socket: ClientSocket;
  playerId?: string;
  secret?: PlayerSecret;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function onceEvent<T>(socket: ClientSocket, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: unknown) => {
      resolve(payload as T);
    });
  });
}

function randomToken(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('socket handlers integration', () => {
  let httpServer: http.Server;
  let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
  let baseUrl = '';
  const sockets: ClientSocket[] = [];
  const stateBySocket = new Map<ClientSocket, RoomPublicState>();

  beforeEach(async () => {
    resetRoomStore();

    const app = express();
    httpServer = http.createServer(app);
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      cors: { origin: '*' }
    });
    registerSocketHandlers(ioServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start test socket server.');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of sockets) {
      if (socket.connected) {
        socket.disconnect();
      }
      stateBySocket.delete(socket);
    }
    sockets.length = 0;

    await new Promise<void>((resolve, reject) => {
      ioServer.close();
      httpServer.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        resolve();
      });
    });

    resetRoomStore();
  });

  async function connectClient(name: string, token: string): Promise<TestClient> {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000
    });

    sockets.push(socket);
    socket.on('room:state_public', (payload) => {
      stateBySocket.set(socket, payload.roomPublicState);
    });

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (error) => reject(error));
      }),
      `connect:${name}`
    );

    return { name, token, socket };
  }

  function getLatestState(client: TestClient): RoomPublicState | undefined {
    return stateBySocket.get(client.socket);
  }

  async function waitForState(
    client: TestClient,
    predicate: (state: RoomPublicState) => boolean,
    label: string,
    timeoutMs = 6000
  ): Promise<RoomPublicState> {
    const cached = getLatestState(client);
    if (cached && predicate(cached)) {
      return cached;
    }

    return new Promise((resolve, reject) => {
      const onState = (payload: { roomPublicState: RoomPublicState }) => {
        const state = payload.roomPublicState;
        stateBySocket.set(client.socket, state);
        if (predicate(state)) {
          cleanup();
          resolve(state);
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for state: ${label}`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        client.socket.off('room:state_public', onState);
      };

      client.socket.on('room:state_public', onState);
    });
  }

  async function createRoom(host: TestClient, mode: 'LIVE' | 'REMOTE' = 'LIVE') {
    const createdPromise = onceEvent<{ roomCode: string; hostKey: string; playerId: string }>(host.socket, 'room:created');
    host.socket.emit('room:create', { mode, name: host.name, playerToken: host.token });
    const created = await withTimeout(createdPromise, 'room:created');
    host.playerId = created.playerId;
    return created;
  }

  async function joinRoom(client: TestClient, roomCode: string): Promise<RoomJoinedPayload> {
    const joinedPromise = onceEvent<RoomJoinedPayload>(client.socket, 'room:joined');
    client.socket.emit('room:join', {
      roomCode,
      name: client.name,
      playerToken: client.token
    });
    const joined = await withTimeout(joinedPromise, `room:joined:${client.name}`);
    client.playerId = joined.playerId;
    return joined;
  }

  async function waitForLobbyCounts(host: TestClient, players: number, ready: number): Promise<void> {
    await waitForState(
      host,
      (state) =>
        state.status === 'LOBBY' &&
        state.playersPublic.length === players &&
        state.playersPublic.filter((player) => player.ready).length === ready,
      `lobby counts players=${players} ready=${ready}`
    );
  }

  async function configureAndStart(
    host: TestClient,
    hostKey: string,
    settings: Settings,
    clients: TestClient[]
  ): Promise<void> {
    const secretPromises = clients.map((client) => onceEvent<PlayerSecret>(client.socket, 'player:secret'));

    host.socket.emit('host:configure', {
      hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });

    host.socket.emit('host:start', { hostKey });

    const secrets = await withTimeout(Promise.all(secretPromises), 'player:secret broadcast');
    secrets.forEach((secret, idx) => {
      clients[idx].secret = secret;
    });

    await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL');
  }

  async function advanceToVote(host: TestClient, hostKey: string): Promise<void> {
    host.socket.emit('host:closeReveal', { hostKey });
    await waitForState(host, (state) => state.status === 'CLUES', 'status:CLUES');

    for (let i = 0; i < 12; i += 1) {
      const current = getLatestState(host);
      if (current?.status === 'VOTE') {
        return;
      }

      host.socket.emit('turn:next', { hostKey });
      try {
        await waitForState(host, (state) => state.status === 'VOTE', 'status:VOTE-step', 250);
        return;
      } catch {
        // continue advancing turns
      }
    }

    await waitForState(host, (state) => state.status === 'VOTE', 'status:VOTE-final');
  }

  it('runs a full 6-player flow and ends when Mr White is eliminated', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const others: TestClient[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const player = await connectClient(`P${i}`, randomToken(`p${i}`));
      await joinRoom(player, created.roomCode);
      others.push(player);
    }

    await waitForLobbyCounts(host, 6, 1);

    host.socket.emit('room:ready', { ready: true });
    for (const player of others) {
      player.socket.emit('room:ready', { ready: true });
    }

    await waitForLobbyCounts(host, 6, 6);

    const settings: Settings = {
      roleCounts: { civil: 5, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    const everyone = [host, ...others];
    await configureAndStart(host, created.hostKey, settings, everyone);
    await advanceToVote(host, created.hostKey);

    const mrWhite = everyone.find((client) => client.secret?.role === 'MR_WHITE');
    expect(mrWhite?.playerId).toBeTruthy();

    const endPromise = onceEvent<GameEndPayload>(host.socket, 'game:end');
    for (const client of everyone) {
      client.socket.emit('vote:cast', { targetPlayerId: mrWhite!.playerId! });
    }

    const end = await withTimeout(endPromise, 'game:end');
    expect(end.winner).toBe('CIVILIANS');
    expect(end.wordPair.a).toBe('Pizza');
    expect(end.wordPair.b).toBe('Empanada');
  });

  it('supports reconnect mid-round and rejects stale socket actions', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const p1 = await connectClient('P1', randomToken('p1'));
    const p2 = await connectClient('P2', randomToken('p2'));
    const p3 = await connectClient('P3', randomToken('p3'));

    await joinRoom(p1, created.roomCode);
    await joinRoom(p2, created.roomCode);
    await joinRoom(p3, created.roomCode);

    await waitForLobbyCounts(host, 4, 1);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    p2.socket.emit('room:ready', { ready: true });
    p3.socket.emit('room:ready', { ready: true });

    await waitForLobbyCounts(host, 4, 4);

    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    const everyone = [host, p1, p2, p3];
    await configureAndStart(host, created.hostKey, settings, everyone);
    await advanceToVote(host, created.hostKey);

    let latestVotesCast = 0;
    host.socket.on('vote:update', (payload) => {
      latestVotesCast = payload.votesCast;
    });

    const p1Replacement = await connectClient('P1', p1.token);
    const joined = await joinRoom(p1Replacement, created.roomCode);
    expect(joined.playerId).toBe(p1.playerId);

    await delay(50);

    const targetId = p2.playerId!;
    const baselineVotes = latestVotesCast;

    p1.socket.emit('vote:cast', { targetPlayerId: targetId });
    await delay(120);
    expect(latestVotesCast).toBe(baselineVotes);

    p1Replacement.socket.emit('vote:cast', { targetPlayerId: targetId });
    await withTimeout(
      new Promise<void>((resolve) => {
        const tick = () => {
          if (latestVotesCast >= baselineVotes + 1) {
            resolve();
            return;
          }
          setTimeout(tick, 20);
        };
        tick();
      }),
      'replacement socket vote accepted'
    );
  });

  it('keeps spectator route public-only with no player secret events', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const player = await connectClient('P1', randomToken('p1'));
    await joinRoom(player, created.roomCode);

    const spectator = await connectClient('Spectator', randomToken('watch'));
    spectator.socket.emit('room:watch', { roomCode: created.roomCode });

    let spectatorSecretEvents = 0;
    spectator.socket.on('player:secret', () => {
      spectatorSecretEvents += 1;
    });

    await waitForLobbyCounts(host, 2, 1);

    host.socket.emit('room:ready', { ready: true });
    player.socket.emit('room:ready', { ready: true });

    await waitForLobbyCounts(host, 2, 2);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    await configureAndStart(host, created.hostKey, settings, [host, player]);
    await delay(150);

    expect(spectatorSecretEvents).toBe(0);
  });
});
