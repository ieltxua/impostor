import http from 'node:http';

import express from 'express';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ClientToServerEvents,
  GameEndPayload,
  PlayerSecret,
  PlayerSecretEnvelope,
  RoomJoinedPayload,
  RoomPublicState,
  ServerToClientEvents,
  Settings
} from '@impostor/shared';

import { getRoom, resetRoomStore } from '../rooms/roomStore.js';
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
    const secretPromises = clients.map((client) => onceEvent<PlayerSecretEnvelope>(client.socket, 'player:secret'));

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
    secrets.forEach((envelope, idx) => {
      clients[idx].secret = envelope.secret;
    });

    await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL');
  }

  async function markAllRevealOpened(host: TestClient, hostKey: string, clients: TestClient[]): Promise<void> {
    let revealState = await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL for reveal tracking');
    const hasLocalPlayers = revealState.playersPublic.some((player) => player.alive && player.isLocalOnly);

    if (hasLocalPlayers) {
      for (let step = 0; step < 20; step += 1) {
        const currentRevealId = revealState.currentRevealPlayerId;
        if (!currentRevealId) {
          break;
        }

        if ((revealState.revealAttemptCountsByPlayerId?.[currentRevealId] ?? 0) < 1) {
          host.socket.emit('host:markRevealOpened', {
            hostKey,
            playerId: currentRevealId
          });
          revealState = await waitForState(
            host,
            (state) => (state.revealAttemptCountsByPlayerId?.[currentRevealId] ?? 0) > 0,
            `reveal opened for ${currentRevealId}`
          );
        }

        const nextRevealPlayerId = revealState.nextRevealPlayerId;
        if (!nextRevealPlayerId) {
          break;
        }

        host.socket.emit('host:nextReveal', { hostKey });
        revealState = await waitForState(
          host,
          (state) => state.status === 'REVEAL' && state.currentRevealPlayerId === nextRevealPlayerId,
          `next reveal ${nextRevealPlayerId}`
        );
      }
    }

    const latestRevealState = getLatestState(host) ?? revealState;
    const connectedRevealClients = clients.filter((client) =>
      latestRevealState.playersPublic.some(
        (player) =>
          player.id === client.playerId &&
          player.alive &&
          player.connected &&
          !player.isLocalOnly
      )
    );

    for (const client of connectedRevealClients) {
      const playerId = client.playerId;
      if (!playerId) {
        continue;
      }
      const attempts = latestRevealState.revealAttemptCountsByPlayerId?.[playerId] ?? 0;
      if (attempts < 1) {
        client.socket.emit('reveal:opened');
      }
    }

    await waitForState(
      host,
      (state) =>
        state.status === 'REVEAL' &&
        state.playersPublic
          .filter((player) => player.alive)
          .every((player) => (state.revealAttemptCountsByPlayerId?.[player.id] ?? 0) > 0),
      'all players revealed at least once'
    );
  }

  async function closeRevealAfterAllOpened(host: TestClient, hostKey: string, clients: TestClient[]): Promise<void> {
    await markAllRevealOpened(host, hostKey, clients);
    host.socket.emit('host:closeReveal', { hostKey });
    await waitForState(host, (state) => state.status === 'CLUES', 'status:CLUES');
  }

  async function advanceToVote(host: TestClient, hostKey: string, clients: TestClient[]): Promise<void> {
    await closeRevealAfterAllOpened(host, hostKey, clients);

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
    await advanceToVote(host, created.hostKey, everyone);

    const mrWhite = everyone.find((client) => client.secret?.role === 'MR_WHITE');
    expect(mrWhite?.playerId).toBeTruthy();

    const endPromise = onceEvent<GameEndPayload>(host.socket, 'game:end');
    for (const client of everyone) {
      client.socket.emit('vote:cast', { targetPlayerId: mrWhite!.playerId! });
    }
    await waitForState(host, (state) => state.status === 'RESOLVE', 'status:RESOLVE');
    host.socket.emit('host:advanceResolve', { hostKey: created.hostKey, startNextWord: false });

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
    await advanceToVote(host, created.hostKey, everyone);

    let latestVotesCast = 0;
    host.socket.on('vote:update', (payload) => {
      latestVotesCast = payload.votesCast;
    });

    const p1Replacement = await connectClient('P1', p1.token);
    const joined = await joinRoom(p1Replacement, created.roomCode);
    expect(joined.playerId).toBe(p1.playerId);

    const baselineVoteTotal = getLatestState(host)?.votesTotal;
    expect(baselineVoteTotal).toBe(4);
    p1.socket.disconnect();
    await delay(120);
    expect(getLatestState(host)?.votesTotal).toBe(baselineVoteTotal);

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

  it('keeps room available during temporary host disconnect and allows host token rejoin', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const player = await connectClient('P1', randomToken('p1'));
    await joinRoom(player, created.roomCode);
    await waitForLobbyCounts(host, 2, 1);

    const hostDisconnectNotice = onceEvent<{ code: string; message: string }>(player.socket, 'server:error');
    host.socket.disconnect();

    const temporaryError = await withTimeout(hostDisconnectNotice, 'server:error host temporary disconnect');
    expect(temporaryError.code).toBe('HOST_DISCONNECTED_TEMPORARY');

    const hostReplacement = await connectClient('Host', host.token);
    const rejoined = await joinRoom(hostReplacement, created.roomCode);
    expect(rejoined.playerId).toBe(created.playerId);
    expect(rejoined.isHost).toBe(true);

    await waitForLobbyCounts(hostReplacement, 2, 1);

    const lateJoiner = await connectClient('Late', randomToken('late'));
    const lateJoin = await joinRoom(lateJoiner, created.roomCode);
    expect(lateJoin.roomCode).toBe(created.roomCode);
  });

  it('keeps host-only room available long enough for host refresh token rejoin', async () => {
    const host = await connectClient('HostSolo', randomToken('host-solo'));
    const created = await createRoom(host, 'LIVE');
    await waitForLobbyCounts(host, 1, 1);

    host.socket.disconnect();

    const hostReplacement = await connectClient('HostSolo', host.token);
    const rejoined = await joinRoom(hostReplacement, created.roomCode);
    expect(rejoined.playerId).toBe(created.playerId);
    expect(rejoined.isHost).toBe(true);

    await waitForLobbyCounts(hostReplacement, 1, 1);
  });

  it('blocks new players from joining once game has started', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const p1 = await connectClient('P1', randomToken('p1'));
    await joinRoom(p1, created.roomCode);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 2, 2);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    await configureAndStart(host, created.hostKey, settings, [host, p1]);

    const late = await connectClient('Late', randomToken('late'));
    const lateErrorPromise = onceEvent<{ code: string; message: string }>(late.socket, 'server:error');
    late.socket.emit('room:join', {
      roomCode: created.roomCode,
      name: 'Late',
      playerToken: randomToken('late-token')
    });
    const lateError = await withTimeout(lateErrorPromise, 'late join blocked after game start');
    expect(lateError.code).toBe('INVALID_STATE');
    expect(lateError.message).toMatch(/previous participants/i);
  });

  it('requires host resume after long idle and blocks actions until host continues', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const p1 = await connectClient('P1', randomToken('p1'));
    await joinRoom(p1, created.roomCode);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 2, 2);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: 30,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    await configureAndStart(host, created.hostKey, settings, [host, p1]);

    host.socket.disconnect();
    p1.socket.disconnect();
    await withTimeout(
      new Promise<void>((resolve) => {
        const tick = () => {
          const snapshot = getRoom(created.roomCode);
          if (snapshot && snapshot.players.every((entry) => !entry.connected)) {
            resolve();
            return;
          }
          setTimeout(tick, 20);
        };
        tick();
      }),
      'all players disconnected before idle injection'
    );

    const runtime = getRoom(created.roomCode);
    if (!runtime) {
      throw new Error('Expected room runtime to exist after disconnect.');
    }
    runtime.emptySinceAt = Date.now() - 11 * 60_000;

    const p1Replacement = await connectClient('P1', p1.token);
    await joinRoom(p1Replacement, created.roomCode);
    const runtimeAfterRejoin = getRoom(created.roomCode);
    expect(runtimeAfterRejoin?.resumePromptRequired).toBe(true);
    expect((runtimeAfterRejoin?.resumeIdleMinutes ?? 0) >= 10).toBe(true);

    const stateAfterRejoin = await waitForState(
      p1Replacement,
      (state) => state.status === 'REVEAL',
      'rejoin state after idle'
    );
    expect(stateAfterRejoin.resumePromptRequired).toBe(true);
    expect((stateAfterRejoin.resumeIdleMinutes ?? 0) >= 10).toBe(true);

    const blockedReveal = onceEvent<{ code: string; message: string }>(p1Replacement.socket, 'server:error');
    p1Replacement.socket.emit('reveal:opened');
    const blockedError = await withTimeout(blockedReveal, 'reveal blocked while waiting host resume');
    expect(blockedError.code).toBe('INVALID_STATE');
    expect(blockedError.message).toMatch(/paused after inactivity/i);

    const hostReplacement = await connectClient('Host', host.token);
    await joinRoom(hostReplacement, created.roomCode);
    hostReplacement.socket.emit('host:resumeAfterIdle', { hostKey: created.hostKey });

    await waitForState(
      hostReplacement,
      (state) => state.resumePromptRequired !== true,
      'resume prompt cleared by host'
    );

    p1Replacement.socket.emit('reveal:opened');
    await waitForState(
      hostReplacement,
      (state) => (state.revealAttemptCountsByPlayerId?.[p1Replacement.playerId!] ?? 0) > 0,
      'reveal works again after host resume'
    );
  }, 15_000);

  it('expires empty rooms after one hour and returns room-not-found on rejoin', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    await waitForLobbyCounts(host, 1, 1);

    host.socket.disconnect();

    const runtime = getRoom(created.roomCode);
    if (!runtime) {
      throw new Error('Expected room runtime to exist after disconnect.');
    }
    runtime.emptySinceAt = Date.now() - (60 * 60 * 1000 + 5_000);

    const hostReplacement = await connectClient('Host', host.token);
    const notFoundPromise = onceEvent<{ code: string; message: string }>(hostReplacement.socket, 'server:error');
    hostReplacement.socket.emit('room:join', {
      roomCode: created.roomCode,
      name: 'Host',
      playerToken: host.token
    });

    const notFound = await withTimeout(notFoundPromise, 'expired room rejection');
    expect(notFound.code).toBe('ROOM_NOT_FOUND');
    expect(getRoom(created.roomCode)).toBeUndefined();
  });

  it('reuses disconnected lobby player slot by name and excludes disconnected players from start counts', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const p1 = await connectClient('P1', randomToken('p1'));
    await joinRoom(p1, created.roomCode);
    await waitForLobbyCounts(host, 2, 1);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 2, 2);

    p1.socket.disconnect();
    await waitForState(
      host,
      (state) => state.status === 'LOBBY' && state.playersPublic.some((player) => player.id === p1.playerId && !player.connected),
      'p1 marked disconnected in lobby'
    );

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });

    const startErrorPromise = onceEvent<{ code: string; message: string }>(host.socket, 'server:error');
    host.socket.emit('host:start', { hostKey: created.hostKey });
    const startError = await withTimeout(startErrorPromise, 'host:start should fail with disconnected ready player');
    expect(startError.code).toBe('INVALID_STATE');
    expect(startError.message).toContain('ready 1');

    const p1Replacement = await connectClient('P1', randomToken('p1-new'));
    const joined = await joinRoom(p1Replacement, created.roomCode);
    expect(joined.playerId).toBe(p1.playerId);

    await waitForState(
      host,
      (state) => state.status === 'LOBBY' && state.playersPublic.some((player) => player.id === p1.playerId && player.connected),
      'p1 reconnected by name'
    );
  });

  it('allows host to pause and resume timed clue turns', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const player = await connectClient('P1', randomToken('p1'));
    await joinRoom(player, created.roomCode);

    host.socket.emit('room:ready', { ready: true });
    player.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 2, 2);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: 5,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    await configureAndStart(host, created.hostKey, settings, [host, player]);
    await closeRevealAfterAllOpened(host, created.hostKey, [host, player]);

    const cluesState = await waitForState(
      host,
      (state) => state.status === 'CLUES' && state.timeRemaining !== undefined,
      'timed clues started'
    );
    expect(cluesState.timerPaused).toBe(false);

    host.socket.emit('host:pauseTimer', { hostKey: created.hostKey });
    const pausedState = await waitForState(host, (state) => state.status === 'CLUES' && state.timerPaused === true, 'timer paused');
    const pausedRemaining = pausedState.timeRemaining ?? 0;
    await delay(1200);
    expect(getLatestState(host)?.timeRemaining).toBe(pausedRemaining);

    host.socket.emit('host:resumeTimer', { hostKey: created.hostKey });
    await waitForState(host, (state) => state.status === 'CLUES' && state.timerPaused === false, 'timer resumed');
    await withTimeout(
      new Promise<void>((resolve) => {
        const tick = () => {
          const latest = getLatestState(host);
          if (latest?.status === 'CLUES' && (latest.timeRemaining ?? pausedRemaining) < pausedRemaining) {
            resolve();
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      }),
      'timer decremented after resume'
    );
  });

  it('allows host to force next turn even when timer is enabled', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const p1 = await connectClient('P1', randomToken('p1'));
    const p2 = await connectClient('P2', randomToken('p2'));
    await joinRoom(p1, created.roomCode);
    await joinRoom(p2, created.roomCode);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    p2.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 3, 3);

    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: 45,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    await configureAndStart(host, created.hostKey, settings, [host, p1, p2]);
    await closeRevealAfterAllOpened(host, created.hostKey, [host, p1, p2]);

    const before = await waitForState(
      host,
      (state) => state.status === 'CLUES' && state.currentSpeakerId !== undefined && state.timeRemaining !== undefined,
      'timed clues before host next'
    );

    host.socket.emit('turn:next', { hostKey: created.hostKey });
    const after = await waitForState(
      host,
      (state) =>
        state.status === 'CLUES' &&
        state.currentSpeakerId !== undefined &&
        state.currentSpeakerId !== before.currentSpeakerId,
      'timed clues after host next'
    );

    expect(after.timeRemaining).toBe(settings.turnSeconds);
    expect(after.timerPaused).toBe(false);
  });

  it('rejects closeReveal until every alive player has opened secret at least once', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const player = await connectClient('P1', randomToken('p1'));
    await joinRoom(player, created.roomCode);

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

    const closeRevealError = onceEvent<{ code: string; message: string }>(host.socket, 'server:error');
    host.socket.emit('host:closeReveal', { hostKey: created.hostKey });

    const error = await withTimeout(closeRevealError, 'close reveal blocked');
    expect(error.code).toBe('INVALID_STATE');
    expect(error.message).toMatch(/reveal at least once/i);

    host.socket.emit('reveal:opened');
    player.socket.emit('reveal:opened');
    await waitForState(
      host,
      (state) =>
        state.status === 'REVEAL' &&
        state.playersPublic
          .filter((entry) => entry.alive)
          .every((entry) => (state.revealAttemptCountsByPlayerId?.[entry.id] ?? 0) > 0),
      'both players marked revealed'
    );
    host.socket.emit('host:closeReveal', { hostKey: created.hostKey });
    await waitForState(host, (state) => state.status === 'CLUES', 'close reveal after all opened');
  });

  it('restores player presence from heartbeat after stale disconnect', async () => {
    const host = await connectClient('HostPresence', randomToken('host-presence'));
    const created = await createRoom(host, 'LIVE');
    const player = await connectClient('PresencePlayer', randomToken('presence-player'));
    await joinRoom(player, created.roomCode);

    const room = getRoom(created.roomCode);
    if (!room || !player.playerId) {
      throw new Error('Expected room and player to exist.');
    }
    const runtimePlayer = room.players.find((entry) => entry.id === player.playerId);
    if (!runtimePlayer) {
      throw new Error('Expected runtime player to exist.');
    }

    runtimePlayer.connected = false;
    runtimePlayer.lastSeenAt = Date.now() - 60_000;
    stateBySocket.delete(host.socket);

    player.socket.emit('presence:heartbeat');

    await waitForState(
      host,
      (state) => state.playersPublic.find((entry) => entry.id === player.playerId)?.connected === true,
      'presence-restored'
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

  it('allows host to close room and return future joins as room-not-found', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const player = await connectClient('P1', randomToken('p1'));
    await joinRoom(player, created.roomCode);

    const closedForPlayer = onceEvent<{ code: string; message: string }>(player.socket, 'server:error');
    host.socket.emit('host:closeRoom', { hostKey: created.hostKey });

    const closeError = await withTimeout(closedForPlayer, 'server:error host close');
    expect(closeError.code).toBe('HOST_DISCONNECTED');

    const lateJoiner = await connectClient('Late', randomToken('late'));
    const lateJoinError = onceEvent<{ code: string; message: string }>(lateJoiner.socket, 'server:error');
    lateJoiner.socket.emit('room:join', {
      roomCode: created.roomCode,
      name: 'Late',
      playerToken: randomToken('late-join')
    });

    const notFound = await withTimeout(lateJoinError, 'server:error room not found');
    expect(notFound.code).toBe('ROOM_NOT_FOUND');
  });

  it('allows host to end game and close room during active match', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const p1 = await connectClient('P1', randomToken('p1'));
    await joinRoom(p1, created.roomCode);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 2, 2);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    await configureAndStart(host, created.hostKey, settings, [host, p1]);
    await waitForState(host, (state) => state.status === 'REVEAL', 'started reveal');

    const playerClosedNotice = onceEvent<{ code: string; message: string }>(p1.socket, 'server:error');
    host.socket.emit('host:closeRoom', { hostKey: created.hostKey });

    const closeError = await withTimeout(playerClosedNotice, 'server:error host close in game');
    expect(closeError.code).toBe('HOST_DISCONNECTED');
    expect(getRoom(created.roomCode)).toBeUndefined();
  });

  it('transfers host to another connected device player on next round', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const p1 = await connectClient('P1', randomToken('p1'));
    const p2 = await connectClient('P2', randomToken('p2'));
    await joinRoom(p1, created.roomCode);
    await joinRoom(p2, created.roomCode);

    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    p2.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 3, 3);

    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };
    await configureAndStart(host, created.hostKey, settings, [host, p1, p2]);
    await waitForState(host, (state) => state.status === 'REVEAL', 'initial reveal for host transfer');

    host.socket.emit('host:transferHost', {
      hostKey: created.hostKey,
      targetPlayerId: p1.playerId!
    });
    await waitForState(
      host,
      (state) => state.pendingHostTransferToPlayerId === p1.playerId,
      'pending host transfer state visible'
    );

    const grantedPromise = onceEvent<{ hostKey: string }>(p1.socket, 'host:granted');
    host.socket.emit('host:nextWord', { hostKey: created.hostKey });
    const granted = await withTimeout(grantedPromise, 'host granted to next host');
    expect(granted.hostKey).toBeTruthy();

    await waitForState(
      host,
      (state) =>
        state.status === 'REVEAL' &&
        state.pendingHostTransferToPlayerId === undefined &&
        state.playersPublic.some((player) => player.id === p1.playerId && player.isHost),
      'host transfer applied on next round'
    );

    const hostClosedNotice = onceEvent<{ code: string; message: string }>(host.socket, 'server:error');
    p1.socket.emit('host:closeRoom', { hostKey: granted.hostKey });
    const closeNotice = await withTimeout(hostClosedNotice, 'new host can close room');
    expect(closeNotice.code).toBe('HOST_DISCONNECTED');
    expect(getRoom(created.roomCode)).toBeUndefined();
  });

  it('supports host-managed local players without requiring extra sockets', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    host.socket.emit('host:addLocalPlayer', { name: 'Local One', hostKey: created.hostKey });
    const withLocal = await waitForState(
      host,
      (state) => state.status === 'LOBBY' && state.playersPublic.some((player) => player.name === 'Local One' && player.isLocalOnly),
      'local player added'
    );
    const localPlayer = withLocal.playersPublic.find((player) => player.name === 'Local One');
    expect(localPlayer?.isLocalOnly).toBe(true);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });
    host.socket.emit('host:start', { hostKey: created.hostKey });

    await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL local');

    await advanceToVote(host, created.hostKey, [host]);
    host.socket.emit('host:voteForPlayer', {
      hostKey: created.hostKey,
      voterPlayerId: localPlayer!.id,
      targetPlayerId: host.playerId!
    });
    const voteState = await waitForState(
      host,
      (state) => state.status === 'VOTE' && (state.votedPlayerIds ?? []).includes(localPlayer!.id),
      'local vote registered'
    );
    expect(voteState.votesTotal).toBe(2);
    expect(voteState.votesCast).toBeGreaterThanOrEqual(1);
  });

  it('supports mixed reveal flow with remote devices plus local no-device players', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const remote = await connectClient('Remote', randomToken('remote'));
    await joinRoom(remote, created.roomCode);

    host.socket.emit('host:addLocalPlayer', { name: 'Local Uno', hostKey: created.hostKey });
    await waitForLobbyCounts(host, 3, 2);

    host.socket.emit('room:ready', { ready: true });
    remote.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 3, 3);

    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });

    const hostSecretPromise = onceEvent<PlayerSecretEnvelope>(host.socket, 'player:secret');
    const remoteSecretPromise = onceEvent<PlayerSecretEnvelope>(remote.socket, 'player:secret');
    host.socket.emit('host:start', { hostKey: created.hostKey });

    const hostSecret = await withTimeout(hostSecretPromise, 'host secret for mixed reveal');
    const remoteSecret = await withTimeout(remoteSecretPromise, 'remote secret for mixed reveal');
    expect(hostSecret.playerId).toBe(host.playerId);
    expect(hostSecret.secret.revealAllowed).toBe(true);
    expect(remoteSecret.playerId).toBe(remote.playerId);
    expect(remoteSecret.secret.revealAllowed).toBe(true);

    const revealState = await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL mixed');
    const currentReveal = revealState.playersPublic.find((entry) => entry.id === revealState.currentRevealPlayerId);
    expect(Boolean(currentReveal?.isLocalOnly || currentReveal?.isHost)).toBe(true);

    const localRevealPlayer = revealState.playersPublic.find((entry) => entry.isLocalOnly);
    expect(localRevealPlayer?.id).toBeTruthy();
    if (currentReveal?.isHost) {
      host.socket.emit('host:markRevealOpened', {
        hostKey: created.hostKey,
        playerId: currentReveal.id
      });
      await waitForState(
        host,
        (state) => (state.revealAttemptCountsByPlayerId?.[currentReveal.id] ?? 0) > 0,
        'mixed reveal host marked before next'
      );
      host.socket.emit('host:nextReveal', { hostKey: created.hostKey });
      await waitForState(
        host,
        (state) => state.status === 'REVEAL' && state.currentRevealPlayerId === localRevealPlayer!.id,
        'mixed reveal advanced to local player'
      );
    }

    const localSecretPromise = onceEvent<{ playerId: string; playerName: string; secret: PlayerSecret }>(
      host.socket,
      'host:localSecret'
    );
    host.socket.emit('host:requestLocalSecret', {
      playerId: localRevealPlayer!.id,
      hostKey: created.hostKey
    });
    const localSecret = await withTimeout(localSecretPromise, 'host local secret in mixed reveal');
    expect(localSecret.playerId).toBe(localRevealPlayer!.id);
    expect(localSecret.secret.revealAllowed).toBe(true);
  });

  it('only emits the active reveal secret when local players are used', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    host.socket.emit('host:addLocalPlayer', { name: 'Local Uno', hostKey: created.hostKey });
    host.socket.emit('host:addLocalPlayer', { name: 'Local Dos', hostKey: created.hostKey });

    await waitForLobbyCounts(host, 3, 3);

    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    const receivedSecrets: PlayerSecret[] = [];
    const onPlayerSecret = (secret: PlayerSecretEnvelope) => {
      receivedSecrets.push(secret.secret);
    };

    host.socket.on('player:secret', onPlayerSecret);
    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });

    host.socket.emit('host:start', { hostKey: created.hostKey });
    const revealState = await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL local anti-cheat');

    await delay(80);
    expect(receivedSecrets).toHaveLength(1);
    expect(typeof receivedSecrets[0].revealAllowed).toBe('boolean');

    if (revealState.nextRevealPlayerId) {
      if (revealState.currentRevealPlayerId) {
        host.socket.emit('host:markRevealOpened', {
          hostKey: created.hostKey,
          playerId: revealState.currentRevealPlayerId
        });
        await waitForState(
          host,
          (state) => (state.revealAttemptCountsByPlayerId?.[revealState.currentRevealPlayerId!] ?? 0) > 0,
          'active reveal marked before next'
        );
      }
      host.socket.emit('host:nextReveal', { hostKey: created.hostKey });
      await waitForState(
        host,
        (state) => state.currentRevealPlayerId === revealState.nextRevealPlayerId,
        'next reveal player active'
      );
      await delay(80);
      expect(receivedSecrets).toHaveLength(2);
      expect(typeof receivedSecrets[1].revealAllowed).toBe('boolean');
    }

    host.socket.off('player:secret', onPlayerSecret);
  });

  it('allows host local secret request for current local reveal and rejects non-current local request', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');
    const remote = await connectClient('Remote', randomToken('remote'));
    await joinRoom(remote, created.roomCode);

    host.socket.emit('host:addLocalPlayer', { name: 'Local Uno', hostKey: created.hostKey });
    host.socket.emit('host:addLocalPlayer', { name: 'Local Dos', hostKey: created.hostKey });

    await waitForLobbyCounts(host, 4, 3);
    remote.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 4, 4);

    const settings: Settings = {
      roleCounts: { civil: 3, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });
    host.socket.emit('host:start', { hostKey: created.hostKey });

    const revealState = await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL local request');
    const localPlayers = revealState.playersPublic.filter((entry) => entry.isLocalOnly);
    expect(localPlayers.length).toBe(2);
    let activeLocalId = revealState.currentRevealPlayerId;
    if (!localPlayers.some((entry) => entry.id === activeLocalId)) {
      if (revealState.currentRevealPlayerId) {
        host.socket.emit('host:markRevealOpened', {
          hostKey: created.hostKey,
          playerId: revealState.currentRevealPlayerId
        });
        await waitForState(
          host,
          (state) => (state.revealAttemptCountsByPlayerId?.[revealState.currentRevealPlayerId!] ?? 0) > 0,
          'status:REVEAL local request host marked'
        );
      }
      host.socket.emit('host:nextReveal', { hostKey: created.hostKey });
      const advancedState = await waitForState(
        host,
        (state) => state.status === 'REVEAL' && localPlayers.some((entry) => entry.id === state.currentRevealPlayerId),
        'status:REVEAL local request advanced to local'
      );
      activeLocalId = advancedState.currentRevealPlayerId;
    }
    expect(localPlayers.some((entry) => entry.id === activeLocalId)).toBe(true);
    const nonCurrentLocal = localPlayers.find((entry) => entry.id !== activeLocalId);
    expect(nonCurrentLocal?.id).toBeTruthy();

    const activeSecretPromise = onceEvent<{ playerId: string; playerName: string; secret: PlayerSecret }>(
      host.socket,
      'host:localSecret'
    );
    host.socket.emit('host:requestLocalSecret', {
      playerId: activeLocalId!,
      hostKey: created.hostKey
    });
    const activeSecret = await withTimeout(activeSecretPromise, 'active local secret accepted');
    expect(activeSecret.playerId).toBe(activeLocalId);
    expect(activeSecret.secret.revealAllowed).toBe(true);

    const errorPromise = onceEvent<{ code: string; message: string }>(host.socket, 'server:error');
    host.socket.emit('host:requestLocalSecret', {
      playerId: nonCurrentLocal!.id,
      hostKey: created.hostKey
    });

    const error = await withTimeout(errorPromise, 'non-current local secret rejected');
    expect(error.code).toBe('INVALID_STATE');
    expect(error.message).toMatch(/active local reveal player/i);
  });

  it('shows all added local players in lobby state', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    for (let index = 0; index < 8; index += 1) {
      host.socket.emit('host:addLocalPlayer', { name: `Invitado ${index}`, hostKey: created.hostKey });
    }

    const withManyLocals = await waitForState(
      host,
      (state) =>
        state.status === 'LOBBY' && state.playersPublic.filter((player) => player.isLocalOnly).length === 8,
      'many local players added'
    );

    expect(withManyLocals.playersPublic.filter((player) => player.isLocalOnly).length).toBe(8);
    expect(withManyLocals.playersPublic.some((player) => player.isHost)).toBe(true);
    expect(withManyLocals.playersPublic.filter((player) => player.name.startsWith('Invitado')).map((player) => player.name)).toHaveLength(8);
  });

  it('supports renaming and removing local players from lobby', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    host.socket.emit('host:addLocalPlayer', { name: 'Invitado Uno', hostKey: created.hostKey });
    const withLocal = await waitForState(
      host,
      (state) =>
        state.status === 'LOBBY' &&
        state.playersPublic.length === 2 &&
        state.playersPublic.some((player) => player.isLocalOnly && player.name === 'Invitado Uno'),
      'local player added'
    );
    const localPlayer = withLocal.playersPublic.find((player) => player.isLocalOnly && player.name === 'Invitado Uno');
    expect(localPlayer).toBeTruthy();

    host.socket.emit('host:renameLocalPlayer', {
      playerId: localPlayer!.id,
      name: 'Invitado Dos',
      hostKey: created.hostKey
    });

    const renamed = await waitForState(
      host,
      (state) => state.status === 'LOBBY' && state.playersPublic.some((player) => player.id === localPlayer!.id && player.name === 'Invitado Dos'),
      'local player renamed'
    );
    expect(renamed.playersPublic.find((player) => player.id === localPlayer!.id)?.name).toBe('Invitado Dos');

    host.socket.emit('host:removeLocalPlayer', { playerId: localPlayer!.id, hostKey: created.hostKey });

    const afterRemove = await waitForState(
      host,
      (state) => state.status === 'LOBBY' && state.playersPublic.length === 1,
      'local player removed'
    );
    expect(afterRemove.playersPublic.some((player) => player.id === localPlayer!.id)).toBe(false);
  });

  it('allows host-managed vote for connected players when table voting is offline', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const p1 = await connectClient('P1', randomToken('p1'));
    const p2 = await connectClient('P2', randomToken('p2'));
    await joinRoom(p1, created.roomCode);
    await joinRoom(p2, created.roomCode);

    await waitForLobbyCounts(host, 3, 1);
    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    p2.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 3, 3);

    const settings: Settings = {
      roleCounts: { civil: 2, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    await configureAndStart(host, created.hostKey, settings, [host, p1, p2]);
    await advanceToVote(host, created.hostKey, [host, p1, p2]);

    host.socket.emit('host:voteForPlayer', {
      hostKey: created.hostKey,
      voterPlayerId: p1.playerId!,
      targetPlayerId: p2.playerId!
    });

    const voteState = await waitForState(
      host,
      (state) => state.status === 'VOTE' && (state.votedPlayerIds ?? []).includes(p1.playerId!),
      'connected player host-managed vote'
    );
    expect(voteState.votesCast).toBeGreaterThanOrEqual(1);
    expect(voteState.votesTotal).toBe(3);
  });

  it('sends each connected player their own secret in LIVE no-local reveal', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const p1 = await connectClient('P1', randomToken('p1'));
    const p2 = await connectClient('P2', randomToken('p2'));
    await joinRoom(p1, created.roomCode);
    await joinRoom(p2, created.roomCode);

    await waitForLobbyCounts(host, 3, 1);
    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    p2.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 3, 3);

    const hostSecret = onceEvent<PlayerSecretEnvelope>(host.socket, 'player:secret');
    const p1Secret = onceEvent<PlayerSecretEnvelope>(p1.socket, 'player:secret');
    const p2Secret = onceEvent<PlayerSecretEnvelope>(p2.socket, 'player:secret');

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 1, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });

    host.socket.emit('host:start', { hostKey: created.hostKey });

    const revealState = await waitForState(host, (state) => state.status === 'REVEAL', 'status:REVEAL no-local anti-cheat');
    expect(revealState.currentRevealPlayerId).toBeTruthy();

    const receivedSecrets = await withTimeout(Promise.all([hostSecret, p1Secret, p2Secret]), 'player:secret for all players');
    const secretPlayerIds = receivedSecrets.map((payload) => payload.playerId).sort();
    expect(secretPlayerIds).toEqual([host.playerId, p1.playerId, p2.playerId].sort());

    const allRoles = new Set(receivedSecrets.map((payload) => payload.secret.role));
    expect(allRoles.has('MR_WHITE')).toBe(true);
    expect(allRoles.size).toBeGreaterThan(1);
  });

  it('lets host skip vote and start the next word immediately', async () => {
    const host = await connectClient('Host', randomToken('host'));
    const created = await createRoom(host, 'LIVE');

    const p1 = await connectClient('P1', randomToken('p1'));
    await joinRoom(p1, created.roomCode);

    await waitForLobbyCounts(host, 2, 1);
    host.socket.emit('room:ready', { ready: true });
    p1.socket.emit('room:ready', { ready: true });
    await waitForLobbyCounts(host, 2, 2);

    const settings: Settings = {
      roleCounts: { civil: 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    await configureAndStart(host, created.hostKey, settings, [host, p1]);
    await advanceToVote(host, created.hostKey, [host, p1]);

    const hostSecretPromise = onceEvent<PlayerSecretEnvelope>(host.socket, 'player:secret');
    const p1SecretPromise = onceEvent<PlayerSecretEnvelope>(p1.socket, 'player:secret');

    host.socket.emit('host:nextWord', { hostKey: created.hostKey });
    await withTimeout(Promise.all([hostSecretPromise, p1SecretPromise]), 'next word secrets');

    const revealState = await waitForState(host, (state) => state.status === 'REVEAL', 'next word reveal');
    expect(revealState.playersPublic).toHaveLength(2);
  });
});
