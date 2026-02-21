import { useEffect, useMemo, useState } from 'react';

import type {
  GameEndPayload,
  Mode,
  PlayerSecret,
  RoomPublicState,
  Settings,
  ServerError,
  WordSource
} from '@impostor/shared';

import { getSocket } from './socket';

const SESSION_KEY = 'impostor.session';

interface SessionState {
  roomCode?: string;
  playerId?: string;
  hostKey?: string;
  playerName?: string;
  playerToken: string;
}

interface RoomStoreState {
  roomCode?: string;
  playerId?: string;
  publicState?: RoomPublicState;
  secret?: PlayerSecret;
  gameEnd?: GameEndPayload;
  mrWhitePrompt?: { maskedWordHintLength: number };
  error?: ServerError;
  connected: boolean;
}

function loadSession(): SessionState {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return { playerToken: crypto.randomUUID() };
    }
    const parsed = JSON.parse(raw) as SessionState;
    if (!parsed.playerToken) {
      parsed.playerToken = crypto.randomUUID();
    }
    return parsed;
  } catch {
    return { playerToken: crypto.randomUUID() };
  }
}

function persistSession(session: SessionState): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function useRoomStore() {
  const socket = useMemo(() => getSocket(), []);
  const isPublicRoute = window.location.pathname === '/public';
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [state, setState] = useState<RoomStoreState>({ connected: socket.connected });

  useEffect(() => {
    persistSession(session);
  }, [session]);

  useEffect(() => {
    const onConnect = () => {
      setState((prev) => ({ ...prev, connected: true }));
      if (!isPublicRoute && session.roomCode && session.playerName) {
        socket.emit('room:join', {
          roomCode: session.roomCode,
          name: session.playerName,
          playerToken: session.playerToken
        });
      }
    };
    const onDisconnect = () => setState((prev) => ({ ...prev, connected: false }));

    const onRoomCreated = (payload: { roomCode: string; hostKey: string; playerId: string }) => {
      setSession((prev) => ({ ...prev, roomCode: payload.roomCode, hostKey: payload.hostKey, playerId: payload.playerId }));
      setState((prev) => ({ ...prev, roomCode: payload.roomCode, playerId: payload.playerId, error: undefined }));
    };

    const onRoomJoined = (payload: { roomCode: string; playerId: string; isHost: boolean; hostKey?: string }) => {
      setSession((prev) => ({
        ...prev,
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        hostKey: payload.isHost ? payload.hostKey : undefined
      }));
      setState((prev) => ({ ...prev, roomCode: payload.roomCode, playerId: payload.playerId, error: undefined }));
    };

    const onPublicState = (payload: { roomPublicState: RoomPublicState }) => {
      setState((prev) => ({
        ...prev,
        publicState: payload.roomPublicState,
        roomCode: payload.roomPublicState.code
      }));
    };

    const onSecret = (payload: PlayerSecret) => {
      setState((prev) => ({ ...prev, secret: payload }));
    };

    const onGameEnd = (payload: GameEndPayload) => {
      setState((prev) => ({ ...prev, gameEnd: payload }));
    };

    const onError = (payload: ServerError) => {
      setState((prev) => ({ ...prev, error: payload }));
    };

    const onGuessPrompt = (payload: { maskedWordHintLength: number }) => {
      setState((prev) => ({ ...prev, mrWhitePrompt: payload }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:created', onRoomCreated);
    socket.on('room:joined', onRoomJoined);
    socket.on('room:state_public', onPublicState);
    socket.on('player:secret', onSecret);
    socket.on('game:end', onGameEnd);
    socket.on('server:error', onError);
    socket.on('mrwhite:guess_prompt', onGuessPrompt);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:created', onRoomCreated);
      socket.off('room:joined', onRoomJoined);
      socket.off('room:state_public', onPublicState);
      socket.off('player:secret', onSecret);
      socket.off('game:end', onGameEnd);
      socket.off('server:error', onError);
      socket.off('mrwhite:guess_prompt', onGuessPrompt);
    };
  }, [isPublicRoute, session, socket]);

  const createRoom = (params: { name: string; mode: Mode }) => {
    setSession((prev) => ({ ...prev, playerName: params.name }));
    socket.emit('room:create', {
      mode: params.mode,
      name: params.name,
      playerToken: session.playerToken
    });
  };

  const withHostKey = (fn: (hostKey: string) => void) => {
    if (!session.hostKey) {
      setState((prev) => ({
        ...prev,
        error: { code: 'UNAUTHORIZED', message: 'Host key missing for host action.' }
      }));
      return;
    }
    fn(session.hostKey);
  };

  const joinRoom = (params: { roomCode: string; name: string }) => {
    setSession((prev) => ({ ...prev, playerName: params.name }));
    socket.emit('room:join', {
      roomCode: params.roomCode,
      name: params.name,
      playerToken: session.playerToken
    });
  };

  const watchRoom = (roomCode: string) => {
    socket.emit('room:watch', { roomCode });
  };

  const toggleReady = (ready: boolean) => {
    socket.emit('room:ready', { ready });
  };

  const configureRoom = (settings: Settings, wordSource: WordSource) => {
    withHostKey((hostKey) => socket.emit('host:configure', { settings, wordSource, hostKey }));
  };

  const startGame = () => withHostKey((hostKey) => socket.emit('host:start', { hostKey }));
  const closeReveal = () => withHostKey((hostKey) => socket.emit('host:closeReveal', { hostKey }));
  const nextTurn = () => withHostKey((hostKey) => socket.emit('turn:next', { hostKey }));
  const castVote = (targetPlayerId: string) => socket.emit('vote:cast', { targetPlayerId });
  const closeVote = () => withHostKey((hostKey) => socket.emit('vote:close', { hostKey }));
  const guessWord = (guess: string) => socket.emit('mrwhite:guess', { guess });
  const resetRoom = () => {
    setState((prev) => ({ ...prev, gameEnd: undefined, mrWhitePrompt: undefined }));
    withHostKey((hostKey) => socket.emit('host:resetRoom', { hostKey }));
  };

  const isHost = Boolean(state.publicState?.playersPublic.find((player) => player.id === (state.playerId ?? session.playerId))?.isHost);

  return {
    ...state,
    roomCode: state.roomCode ?? session.roomCode,
    playerId: state.playerId ?? session.playerId,
    isHost,
    createRoom,
    joinRoom,
    watchRoom,
    toggleReady,
    configureRoom,
    startGame,
    closeReveal,
    nextTurn,
    castVote,
    closeVote,
    guessWord,
    resetRoom
  };
}
