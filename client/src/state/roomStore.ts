import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  GameEndPayload,
  HostLocalSecretPayload,
  Mode,
  PlayerSecretEnvelope,
  PlayerSecret,
  RoomPublicState,
  Settings,
  ServerError,
  WordSource
} from '@impostor/shared';

import { resolveInviteRoomCode, resolveRouteContext } from '../routing/routeContext';
import { getLocale } from '../i18n';
import { getSocket } from './socket';

const SESSION_KEY = 'impostor.session';
const PRESENCE_HEARTBEAT_INTERVAL_MS = 4_000;

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
  myVoteTargetId?: string;
  secret?: PlayerSecret;
  localSecretPreview?: HostLocalSecretPayload;
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

function toHomeSession(previous: SessionState): SessionState {
  return {
    playerToken: previous.playerToken,
    playerName: previous.playerName
  };
}

function toHomeState(connected: boolean, error?: ServerError): RoomStoreState {
  return {
    connected,
    roomCode: undefined,
    playerId: undefined,
    myVoteTargetId: undefined,
    publicState: undefined,
    secret: undefined,
    localSecretPreview: undefined,
    gameEnd: undefined,
    mrWhitePrompt: undefined,
    error
  };
}

export function useRoomStore() {
  const socket = useMemo(() => getSocket(), []);
  const routeContext = useMemo(() => resolveRouteContext(window.location.pathname, import.meta.env.BASE_URL), []);
  const isPublicRoute = useMemo(() => {
    return routeContext.appPath === '/public';
  }, [routeContext.appPath]);
  const inviteRoomCode = useMemo(
    () => resolveInviteRoomCode(window.location.pathname, window.location.search, import.meta.env.BASE_URL),
    []
  );
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const sessionRef = useRef(session);
  const [state, setState] = useState<RoomStoreState>({ connected: socket.connected });
  const stateRef = useRef(state);
  const updateSession = (updater: (previous: SessionState) => SessionState) => {
    setSession((previous) => {
      const next = updater(previous);
      sessionRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    sessionRef.current = session;
    persistSession(session);
  }, [session]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const emitHeartbeat = useCallback(() => {
    if (isPublicRoute || !socket.connected) {
      return;
    }
    const activeRoomCode = stateRef.current.publicState?.code ?? stateRef.current.roomCode ?? sessionRef.current.roomCode;
    if (!activeRoomCode || !sessionRef.current.playerId) {
      return;
    }
    socket.emit('presence:heartbeat');
  }, [isPublicRoute, socket]);

  useEffect(() => {
    if (isPublicRoute) {
      return;
    }

    const intervalId = window.setInterval(() => {
      emitHeartbeat();
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    const onFocus = () => emitHeartbeat();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        emitHeartbeat();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    if (socket.connected) {
      emitHeartbeat();
    }

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isPublicRoute, socket]);

  useEffect(() => {
    const onConnect = () => {
      setState((prev) => ({ ...prev, connected: true }));
      const reconnectSession = sessionRef.current;
      const inviteTargetsDifferentRoom = Boolean(
        inviteRoomCode && reconnectSession.roomCode && inviteRoomCode !== reconnectSession.roomCode
      );
      if (!isPublicRoute && !inviteTargetsDifferentRoom && reconnectSession.roomCode && reconnectSession.playerName) {
        socket.emit('room:join', {
          roomCode: reconnectSession.roomCode,
          name: reconnectSession.playerName,
          playerToken: reconnectSession.playerToken
        });
      }
      emitHeartbeat();
    };
    const onDisconnect = () => setState((prev) => ({ ...prev, connected: false }));

    const onRoomCreated = (payload: { roomCode: string; hostKey: string; playerId: string }) => {
      updateSession((prev) => ({ ...prev, roomCode: payload.roomCode, hostKey: payload.hostKey, playerId: payload.playerId }));
      setState((prev) => ({
        ...prev,
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        localSecretPreview: undefined,
        error: undefined
      }));
      socket.emit('presence:heartbeat');
    };

    const onRoomJoined = (payload: { roomCode: string; playerId: string; isHost: boolean; hostKey?: string }) => {
      updateSession((prev) => ({
        ...prev,
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        hostKey: payload.isHost ? payload.hostKey : undefined
      }));
      setState((prev) => ({
        ...prev,
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        localSecretPreview: undefined,
        error: undefined
      }));
      socket.emit('presence:heartbeat');
    };

    const onPublicState = (payload: { roomPublicState: RoomPublicState }) => {
      const isVoting = payload.roomPublicState.status === 'VOTE';
      setState((prev) => ({
        ...prev,
        publicState: payload.roomPublicState,
        roomCode: payload.roomPublicState.code,
        gameEnd: payload.roomPublicState.status === 'END' ? prev.gameEnd : undefined,
        mrWhitePrompt: payload.roomPublicState.status === 'RESOLVE' ? prev.mrWhitePrompt : undefined,
        myVoteTargetId: isVoting ? prev.myVoteTargetId : undefined,
        localSecretPreview:
          payload.roomPublicState.status === 'REVEAL' &&
          prev.localSecretPreview &&
          payload.roomPublicState.currentRevealPlayerId === prev.localSecretPreview.playerId &&
          payload.roomPublicState.playersPublic.some((player) => player.id === prev.localSecretPreview?.playerId)
            ? prev.localSecretPreview
            : undefined
      }));
    };

    const onSecret = (payload: PlayerSecretEnvelope) => {
      if (payload.playerId !== stateRef.current.playerId) {
        return;
      }
      setState((prev) => ({ ...prev, secret: payload.secret }));
    };

    const onGameEnd = (payload: GameEndPayload) => {
      setState((prev) => ({ ...prev, gameEnd: payload }));
    };

    const onError = (payload: ServerError) => {
      if (payload.code === 'ROOM_NOT_FOUND') {
        const activeRoomCode =
          stateRef.current.publicState?.code ?? stateRef.current.roomCode ?? sessionRef.current.roomCode;
        if (payload.roomCode && activeRoomCode && payload.roomCode !== activeRoomCode) {
          return;
        }
        updateSession((prev) => toHomeSession(prev));
        setState((prev) => toHomeState(prev.connected, payload));
        return;
      }
      if (payload.code === 'HOST_DISCONNECTED') {
        updateSession((prev) => toHomeSession(prev));
        setState((prev) => toHomeState(prev.connected, payload));
        return;
      }
      if (payload.code === 'HOST_DISCONNECTED_TEMPORARY') {
        setState((prev) => ({ ...prev, error: payload }));
        return;
      }
      setState((prev) => ({ ...prev, error: payload }));
    };

    const onGuessPrompt = (payload: { maskedWordHintLength: number }) => {
      setState((prev) => ({ ...prev, mrWhitePrompt: payload }));
    };

    const onHostLocalSecret = (payload: HostLocalSecretPayload) => {
      setState((prev) => ({ ...prev, localSecretPreview: payload }));
    };

    const onHostGranted = (payload: { hostKey: string }) => {
      updateSession((prev) => ({ ...prev, hostKey: payload.hostKey }));
    };

    const onVoteState = (payload: { targetPlayerId?: string }) => {
      setState((prev) => ({ ...prev, myVoteTargetId: payload.targetPlayerId }));
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
    socket.on('host:localSecret', onHostLocalSecret);
    socket.on('host:granted', onHostGranted);
    socket.on('vote:state', onVoteState);

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
      socket.off('host:localSecret', onHostLocalSecret);
      socket.off('host:granted', onHostGranted);
      socket.off('vote:state', onVoteState);
    };
  }, [emitHeartbeat, inviteRoomCode, isPublicRoute, socket]);

  const createRoom = (params: { name: string; mode: Mode }) => {
    updateSession((prev) => ({ ...prev, playerName: params.name }));
    setState((prev) => ({ ...prev, error: undefined }));
    socket.emit('room:create', {
      mode: params.mode,
      name: params.name,
      playerToken: sessionRef.current.playerToken,
      wordLocale: getLocale()
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
    emitHeartbeat();
    fn(session.hostKey);
  };

  const joinRoom = (params: { roomCode: string; name: string }) => {
    const shouldReuseToken =
      (sessionRef.current.playerName || '').trim().toLowerCase() === params.name.trim().toLowerCase() &&
      sessionRef.current.roomCode?.toUpperCase() === params.roomCode.toUpperCase();
    updateSession((prev) => ({ ...prev, playerName: params.name }));
    setState((prev) => ({ ...prev, error: undefined }));
    socket.emit('room:join', {
      roomCode: params.roomCode,
      name: params.name,
      playerToken: shouldReuseToken ? sessionRef.current.playerToken : undefined
    });
  };

  const watchRoom = (roomCode: string) => {
    socket.emit('room:watch', { roomCode });
  };

  const toggleReady = (ready: boolean) => {
    emitHeartbeat();
    socket.emit('room:ready', { ready });
  };

  const configureRoom = (settings: Settings, wordSource: WordSource) => {
    withHostKey((hostKey) => socket.emit('host:configure', { settings, wordSource, hostKey }));
  };

  const addLocalPlayer = (name: string) =>
    withHostKey((hostKey) => socket.emit('host:addLocalPlayer', { name, hostKey }));
  const removeLocalPlayer = (playerId: string) =>
    withHostKey((hostKey) => socket.emit('host:removeLocalPlayer', { playerId, hostKey }));
  const renameLocalPlayer = (playerId: string, name: string) =>
    withHostKey((hostKey) => socket.emit('host:renameLocalPlayer', { playerId, name, hostKey }));

  const startGame = () => withHostKey((hostKey) => socket.emit('host:start', { hostKey }));
  const closeReveal = () => {
    setState((prev) => ({ ...prev, localSecretPreview: undefined }));
    withHostKey((hostKey) => socket.emit('host:closeReveal', { hostKey }));
  };
  const revealOpened = () => {
    emitHeartbeat();
    socket.emit('reveal:opened');
  };
  const markRevealOpenedForPlayer = (playerId: string) =>
    withHostKey((hostKey) => socket.emit('host:markRevealOpened', { playerId, hostKey }));
  const nextReveal = () => {
    setState((prev) => ({ ...prev, localSecretPreview: undefined }));
    withHostKey((hostKey) => socket.emit('host:nextReveal', { hostKey }));
  };
  const nextTurn = () => withHostKey((hostKey) => socket.emit('turn:next', { hostKey }));
  const pauseTimer = () => withHostKey((hostKey) => socket.emit('host:pauseTimer', { hostKey }));
  const resumeTimer = () => withHostKey((hostKey) => socket.emit('host:resumeTimer', { hostKey }));
  const castVote = (targetPlayerId: string) => {
    setState((prev) => ({ ...prev, myVoteTargetId: targetPlayerId }));
    emitHeartbeat();
    socket.emit('vote:cast', { targetPlayerId });
  };
  const castVoteForPlayer = (voterPlayerId: string, targetPlayerId: string) =>
    withHostKey((hostKey) => socket.emit('host:voteForPlayer', { voterPlayerId, targetPlayerId, hostKey }));
  const nextWord = () => {
    setState((prev) => ({ ...prev, localSecretPreview: undefined, gameEnd: undefined, mrWhitePrompt: undefined }));
    withHostKey((hostKey) => socket.emit('host:nextWord', { hostKey }));
  };
  const closeVote = () => withHostKey((hostKey) => socket.emit('vote:close', { hostKey }));
  const resumeAfterIdle = () => withHostKey((hostKey) => socket.emit('host:resumeAfterIdle', { hostKey }));
  const transferHost = (targetPlayerId: string) =>
    withHostKey((hostKey) => socket.emit('host:transferHost', { targetPlayerId, hostKey }));
  const guessWord = (guess: string) => {
    emitHeartbeat();
    socket.emit('mrwhite:guess', { guess });
  };
  const advanceResolve = (startNextWord = false) => {
    setState((prev) => ({ ...prev, gameEnd: undefined, mrWhitePrompt: undefined }));
    withHostKey((hostKey) => socket.emit('host:advanceResolve', { hostKey, startNextWord }));
  };
  const requestLocalSecret = (playerId: string) =>
    withHostKey((hostKey) => socket.emit('host:requestLocalSecret', { playerId, hostKey }));
  const resetRoom = () => {
    setState((prev) => ({ ...prev, gameEnd: undefined, mrWhitePrompt: undefined, localSecretPreview: undefined }));
    withHostKey((hostKey) => socket.emit('host:resetRoom', { hostKey }));
  };

  const closeCreatedRoom = () => {
    withHostKey((hostKey) => socket.emit('host:closeRoom', { hostKey }));
    updateSession((prev) => toHomeSession(prev));
    setState((prev) => toHomeState(prev.connected));
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
    addLocalPlayer,
    removeLocalPlayer,
    renameLocalPlayer,
    configureRoom,
    startGame,
    closeReveal,
    revealOpened,
    markRevealOpenedForPlayer,
    nextReveal,
    nextTurn,
    pauseTimer,
    resumeTimer,
    castVote,
    castVoteForPlayer,
    nextWord,
    closeVote,
    resumeAfterIdle,
    transferHost,
    guessWord,
    advanceResolve,
    requestLocalSecret,
    resetRoom,
    closeCreatedRoom
  };
}
