import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';

import type {
  ClientToServerEvents,
  GameEndPayload,
  PlayerSecret,
  RoomJoinedPayload,
  RoomPublicState,
  ServerToClientEvents,
  Settings,
  Winner
} from '@impostor/shared';

import { resetRoomStore } from '../rooms/roomStore.js';
import { registerSocketHandlers } from '../socket/handlers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Mode = 'LIVE' | 'REMOTE';

interface SimulationOptions {
  players: number;
  matches: number;
  seed: number;
  mode: Mode;
  chaos: boolean;
  disconnectRate: number;
  timeoutMs: number;
  outputPath?: string;
  verbose: boolean;
  watchPublic: boolean;
}

interface SimulationClient {
  name: string;
  token: string;
  socket: ClientSocket;
  playerId?: string;
  secret?: PlayerSecret;
}

interface MatchResult {
  matchIndex: number;
  roomCode?: string;
  status: 'passed' | 'failed';
  winner?: Winner;
  reason?: string;
  roundNumber?: number;
  durationMs: number;
  reconnectDrillRan: boolean;
  staleSocketRejected: boolean;
  replacementVoteAccepted: boolean;
  publicSecretLeakEvents: number;
  error?: string;
}

interface SimulationReport {
  generatedAt: string;
  options: SimulationOptions;
  summary: {
    matches: number;
    passed: number;
    failed: number;
    averageDurationMs: number;
    averageRounds: number;
    totalPublicSecretLeakEvents: number;
  };
  results: MatchResult[];
}

const DEFAULT_OPTIONS: SimulationOptions = {
  players: 8,
  matches: 20,
  seed: Date.now(),
  mode: 'LIVE',
  chaos: false,
  disconnectRate: 0.2,
  timeoutMs: 6000,
  verbose: false,
  watchPublic: true
};

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pickOne<T>(items: T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from empty list.');
  }
  return items[Math.floor(rng() * items.length)];
}

function randomToken(prefix: string, rng: () => number): string {
  return `${prefix}-${Math.floor(rng() * 1e9).toString(36)}-${Math.floor(rng() * 1e9).toString(36)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
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

function getLatestState(client: SimulationClient, stateBySocket: Map<ClientSocket, RoomPublicState>): RoomPublicState | undefined {
  return stateBySocket.get(client.socket);
}

async function waitForState(
  client: SimulationClient,
  stateBySocket: Map<ClientSocket, RoomPublicState>,
  predicate: (state: RoomPublicState) => boolean,
  label: string,
  timeoutMs: number
): Promise<RoomPublicState> {
  const cached = getLatestState(client, stateBySocket);
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

async function connectClient(
  baseUrl: string,
  name: string,
  token: string,
  sockets: ClientSocket[],
  stateBySocket: Map<ClientSocket, RoomPublicState>,
  timeoutMs: number
): Promise<SimulationClient> {
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
    `connect:${name}`,
    timeoutMs
  );

  return { name, token, socket };
}

async function createRoom(host: SimulationClient, mode: Mode, timeoutMs: number): Promise<{ roomCode: string; hostKey: string; playerId: string }> {
  const createdPromise = onceEvent<{ roomCode: string; hostKey: string; playerId: string }>(host.socket, 'room:created');
  host.socket.emit('room:create', { mode, name: host.name, playerToken: host.token });
  const created = await withTimeout(createdPromise, 'room:created', timeoutMs);
  host.playerId = created.playerId;
  return created;
}

async function joinRoom(client: SimulationClient, roomCode: string, timeoutMs: number): Promise<RoomJoinedPayload> {
  const joinedPromise = onceEvent<RoomJoinedPayload>(client.socket, 'room:joined');
  client.socket.emit('room:join', {
    roomCode,
    name: client.name,
    playerToken: client.token
  });
  const joined = await withTimeout(joinedPromise, `room:joined:${client.name}`, timeoutMs);
  client.playerId = joined.playerId;
  return joined;
}

function chooseVoteTarget(voterId: string, alivePlayerIds: string[], preferredId: string | undefined, rng: () => number): string {
  if (preferredId && preferredId !== voterId && alivePlayerIds.includes(preferredId)) {
    return preferredId;
  }
  const candidates = alivePlayerIds.filter((id) => id !== voterId);
  if (candidates.length === 0) {
    return voterId;
  }
  return pickOne(candidates, rng);
}

async function runMatch(
  baseUrl: string,
  options: SimulationOptions,
  rng: () => number,
  matchIndex: number
): Promise<MatchResult> {
  const startedAt = Date.now();
  const sockets: ClientSocket[] = [];
  const stateBySocket = new Map<ClientSocket, RoomPublicState>();
  let reconnectDrillRan = false;
  let staleSocketRejected = false;
  let replacementVoteAccepted = false;
  let publicSecretLeakEvents = 0;
  let roomCode: string | undefined;

  try {
    const host = await connectClient(
      baseUrl,
      `Host-${matchIndex}`,
      randomToken(`host-${matchIndex}`, rng),
      sockets,
      stateBySocket,
      options.timeoutMs
    );

    const created = await createRoom(host, options.mode, options.timeoutMs);
    roomCode = created.roomCode;

    const players: SimulationClient[] = [];
    for (let i = 1; i < options.players; i += 1) {
      const player = await connectClient(
        baseUrl,
        `P${i}-M${matchIndex}`,
        randomToken(`m${matchIndex}-p${i}`, rng),
        sockets,
        stateBySocket,
        options.timeoutMs
      );
      await joinRoom(player, created.roomCode, options.timeoutMs);
      players.push(player);
    }

    let spectator: SimulationClient | undefined;
    if (options.watchPublic) {
      spectator = await connectClient(
        baseUrl,
        `Spectator-M${matchIndex}`,
        randomToken(`spectator-${matchIndex}`, rng),
        sockets,
        stateBySocket,
        options.timeoutMs
      );
      spectator.socket.on('player:secret', () => {
        publicSecretLeakEvents += 1;
      });
      spectator.socket.emit('room:watch', { roomCode: created.roomCode });
    }

    const everyone = [host, ...players];

    await waitForState(
      host,
      stateBySocket,
      (state) => state.status === 'LOBBY' && state.playersPublic.length === options.players,
      `lobby player count ${options.players}`,
      options.timeoutMs
    );

    for (const client of everyone) {
      client.socket.emit('room:ready', { ready: true });
    }

    await waitForState(
      host,
      stateBySocket,
      (state) => state.status === 'LOBBY' && state.playersPublic.filter((entry) => entry.ready).length === options.players,
      `lobby ready count ${options.players}`,
      options.timeoutMs
    );

    const settings: Settings = {
      roleCounts: { civil: options.players - 1, undercover: 0, mrWhite: 1 },
      turnSeconds: null,
      allowSecretReviewInRemote: true,
      mrWhiteCanGuessOnElim: false,
      showVoteTally: true,
      winPreset: 'SIMPLE'
    };

    const secretPromises = everyone.map((client) => onceEvent<PlayerSecret>(client.socket, 'player:secret'));

    host.socket.emit('host:configure', {
      hostKey: created.hostKey,
      settings,
      wordSource: {
        type: 'CUSTOM',
        pair: { a: 'Pizza', b: 'Empanada', category: 'Food' }
      }
    });
    host.socket.emit('host:start', { hostKey: created.hostKey });

    const secrets = await withTimeout(Promise.all(secretPromises), 'player:secret broadcast', options.timeoutMs);
    secrets.forEach((secret, index) => {
      everyone[index].secret = secret;
    });

    await waitForState(host, stateBySocket, (state) => state.status === 'REVEAL', 'status:REVEAL', options.timeoutMs);

    host.socket.emit('host:closeReveal', { hostKey: created.hostKey });
    await waitForState(host, stateBySocket, (state) => state.status === 'CLUES', 'status:CLUES', options.timeoutMs);

    let reconnectSource: SimulationClient | undefined;
    let replacementClient: SimulationClient | undefined;

    const shouldRunReconnectDrill = players.length > 0 && (options.chaos || matchIndex === 1 || rng() < options.disconnectRate);
    if (shouldRunReconnectDrill) {
      reconnectDrillRan = true;
      reconnectSource = pickOne(players, rng);
      replacementClient = await connectClient(
        baseUrl,
        reconnectSource.name,
        reconnectSource.token,
        sockets,
        stateBySocket,
        options.timeoutMs
      );
      const joined = await joinRoom(replacementClient, created.roomCode, options.timeoutMs);
      if (joined.playerId !== reconnectSource.playerId) {
        throw new Error('Reconnect drill failed: replacement socket did not bind to original playerId.');
      }
      replacementClient.secret = reconnectSource.secret;
    }

    for (let step = 0; step < options.players + 4; step += 1) {
      const state = getLatestState(host, stateBySocket);
      if (state?.status === 'VOTE') {
        break;
      }
      host.socket.emit('turn:next', { hostKey: created.hostKey });
      await delay(35);
    }

    const voteState = await waitForState(host, stateBySocket, (state) => state.status === 'VOTE', 'status:VOTE', options.timeoutMs);

    const endPromise = onceEvent<GameEndPayload>(host.socket, 'game:end');

    let baselineVotes = voteState.votesCast ?? 0;
    if (reconnectSource && replacementClient) {
      const staleTarget = chooseVoteTarget(
        reconnectSource.playerId!,
        voteState.playersPublic.filter((entry) => entry.alive).map((entry) => entry.id),
        undefined,
        rng
      );

      reconnectSource.socket.emit('vote:cast', { targetPlayerId: staleTarget });
      await delay(140);

      const afterStale = getLatestState(host, stateBySocket);
      const staleVotes = afterStale?.votesCast ?? baselineVotes;
      staleSocketRejected = staleVotes === baselineVotes;

      const replacementTarget = chooseVoteTarget(
        replacementClient.playerId!,
        (afterStale ?? voteState).playersPublic.filter((entry) => entry.alive).map((entry) => entry.id),
        undefined,
        rng
      );
      replacementClient.socket.emit('vote:cast', { targetPlayerId: replacementTarget });

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            const latest = getLatestState(host, stateBySocket);
            if ((latest?.votesCast ?? 0) > baselineVotes) {
              resolve();
              return;
            }
            if (Date.now() - started > options.timeoutMs) {
              reject(new Error('Reconnect drill failed: replacement vote was not accepted.'));
              return;
            }
            setTimeout(tick, 30);
          };
          tick();
        }),
        'replacement vote acceptance',
        options.timeoutMs
      );

      replacementVoteAccepted = true;
      baselineVotes = getLatestState(host, stateBySocket)?.votesCast ?? baselineVotes;
    }

    const mrWhitePlayer = everyone.find((client) => client.secret?.role === 'MR_WHITE');
    const latestVoteState = getLatestState(host, stateBySocket) ?? voteState;
    const alivePlayerIds = latestVoteState.playersPublic.filter((entry) => entry.alive).map((entry) => entry.id);

    const activeByPlayerId = new Map<string, SimulationClient>();
    for (const client of everyone) {
      if (client.playerId) {
        activeByPlayerId.set(client.playerId, client);
      }
    }
    if (replacementClient?.playerId) {
      activeByPlayerId.set(replacementClient.playerId, replacementClient);
    }

    for (const [playerId, client] of activeByPlayerId.entries()) {
      if (!alivePlayerIds.includes(playerId)) {
        continue;
      }
      const targetPlayerId = chooseVoteTarget(playerId, alivePlayerIds, mrWhitePlayer?.playerId, rng);
      client.socket.emit('vote:cast', { targetPlayerId });
    }

    const end = await withTimeout(endPromise, 'game:end', options.timeoutMs * 2);

    const endState = await waitForState(host, stateBySocket, (state) => state.status === 'END', 'status:END', options.timeoutMs);

    if (reconnectDrillRan && !staleSocketRejected) {
      throw new Error('Reconnect drill failed: stale socket vote was accepted.');
    }
    if (reconnectDrillRan && !replacementVoteAccepted) {
      throw new Error('Reconnect drill failed: replacement vote was not accepted.');
    }
    if (options.watchPublic && publicSecretLeakEvents > 0) {
      throw new Error(`Public secrecy drill failed: spectator received ${publicSecretLeakEvents} secret event(s).`);
    }

    return {
      matchIndex,
      roomCode,
      status: 'passed',
      winner: end.winner,
      reason: end.reason,
      roundNumber: endState.roundNumber,
      durationMs: Date.now() - startedAt,
      reconnectDrillRan,
      staleSocketRejected,
      replacementVoteAccepted,
      publicSecretLeakEvents
    };
  } catch (error) {
    return {
      matchIndex,
      roomCode,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      reconnectDrillRan,
      staleSocketRejected,
      replacementVoteAccepted,
      publicSecretLeakEvents,
      error: error instanceof Error ? error.message : 'Unknown simulation error.'
    };
  } finally {
    for (const socket of sockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
  }
}

function parseArgs(argv: string[]): SimulationOptions {
  const options: SimulationOptions = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--players') {
      options.players = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--matches') {
      options.matches = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--seed') {
      options.seed = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--mode') {
      const mode = argv[i + 1] as Mode;
      options.mode = mode;
      i += 1;
      continue;
    }
    if (arg === '--output') {
      options.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--disconnect-rate') {
      options.disconnectRate = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--chaos') {
      options.chaos = true;
      continue;
    }
    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }
    if (arg === '--no-public-watch') {
      options.watchPublic = false;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run sim:pilot --workspace server -- [options]');
      console.log('  --players <n>          total players including host (default: 8)');
      console.log('  --matches <n>          number of matches (default: 20)');
      console.log('  --seed <n>             deterministic seed (default: Date.now())');
      console.log('  --mode <LIVE|REMOTE>   room mode (default: LIVE)');
      console.log('  --chaos                always run reconnect drill');
      console.log('  --disconnect-rate <0-1> reconnect drill probability (default: 0.2)');
      console.log('  --timeout-ms <n>       per-step timeout in ms (default: 6000)');
      console.log('  --output <path>        report output path (default: reports/sim/pilot-sim-*.json)');
      console.log('  --verbose              print per-match result lines');
      console.log('  --no-public-watch      skip spectator secret leak check');
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.players) || options.players < 4 || options.players > 15) {
    throw new Error('--players must be an integer between 4 and 15.');
  }
  if (!Number.isInteger(options.matches) || options.matches < 1) {
    throw new Error('--matches must be a positive integer.');
  }
  if (!Number.isFinite(options.seed)) {
    throw new Error('--seed must be a finite number.');
  }
  if (options.mode !== 'LIVE' && options.mode !== 'REMOTE') {
    throw new Error('--mode must be LIVE or REMOTE.');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be at least 1000.');
  }
  if (!Number.isFinite(options.disconnectRate) || options.disconnectRate < 0 || options.disconnectRate > 1) {
    throw new Error('--disconnect-rate must be in range 0..1.');
  }

  return options;
}

async function startLocalServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  resetRoomStore();

  const app = express();
  const httpServer = http.createServer(app);
  const ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' }
  });

  registerSocketHandlers(ioServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start simulation socket server.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
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
    }
  };
}

function resolveDefaultReportPath(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../../..');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(repoRoot, 'reports', 'sim', `pilot-sim-${stamp}.json`);
}

async function writeReport(report: SimulationReport, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const runner = await startLocalServer();
  const results: MatchResult[] = [];

  try {
    for (let i = 0; i < options.matches; i += 1) {
      const matchRng = createRng((options.seed + i * 7919) >>> 0);
      const result = await runMatch(runner.baseUrl, options, matchRng, i + 1);
      results.push(result);

      if (options.verbose) {
        const label = result.status === 'passed' ? 'PASS' : 'FAIL';
        const reason = result.reason ?? result.error ?? '-';
        console.log(`[${label}] match=${result.matchIndex} room=${result.roomCode ?? '-'} winner=${result.winner ?? '-'} reason=${reason}`);
      }
    }
  } finally {
    await runner.close();
  }

  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.length - passed;

  const averageDurationMs = Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / results.length);
  const roundsValues = results.map((result) => result.roundNumber ?? 0);
  const averageRounds = Number((roundsValues.reduce((sum, value) => sum + value, 0) / roundsValues.length).toFixed(2));
  const totalPublicSecretLeakEvents = results.reduce((sum, result) => sum + result.publicSecretLeakEvents, 0);

  const report: SimulationReport = {
    generatedAt: new Date().toISOString(),
    options,
    summary: {
      matches: options.matches,
      passed,
      failed,
      averageDurationMs,
      averageRounds,
      totalPublicSecretLeakEvents
    },
    results
  };

  const outputPath = options.outputPath ?? resolveDefaultReportPath();
  await writeReport(report, outputPath);

  console.log('pilot simulation complete');
  console.log(`matches: ${options.matches} | passed: ${passed} | failed: ${failed}`);
  console.log(`avg duration: ${averageDurationMs}ms | avg rounds: ${averageRounds}`);
  console.log(`public secret leaks: ${totalPublicSecretLeakEvents}`);
  console.log(`report: ${outputPath}`);

  if (failed > 0) {
    const firstFailure = results.find((result) => result.status === 'failed');
    if (firstFailure?.error) {
      console.error(`first failure: match ${firstFailure.matchIndex} -> ${firstFailure.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
