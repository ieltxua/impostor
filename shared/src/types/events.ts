import type {
  EliminationResult,
  Mode,
  PlayerSecret,
  WordLocale,
  RoomPublicState,
  Settings,
  Status,
  Winner,
  WordPair
} from './room.js';

export interface WordSourceRandom {
  type: 'RANDOM';
  categories?: string[];
  category?: string;
}

export interface WordSourceCustom {
  type: 'CUSTOM';
  pair: WordPair;
}

export type WordSource = WordSourceRandom | WordSourceCustom;

export interface ServerError {
  code:
    | 'ROOM_NOT_FOUND'
    | 'NAME_TAKEN'
    | 'INVALID_STATE'
    | 'UNAUTHORIZED'
    | 'INVALID_PAYLOAD'
    | 'HOST_DISCONNECTED'
    | 'HOST_DISCONNECTED_TEMPORARY';
  message: string;
  roomCode?: string;
}

export interface RoomCreatedPayload {
  roomCode: string;
  hostKey: string;
  playerId: string;
}

export interface RoomJoinedPayload {
  roomCode: string;
  playerId: string;
  isHost: boolean;
  hostKey?: string;
}

export interface GameEndPayload {
  winner: Winner;
  reason: string;
  wordPair: WordPair;
}

export interface VoteUpdatePayload {
  votesCast: number;
  votesTotal: number;
}

export interface TurnUpdatePayload {
  currentSpeakerId?: string;
  timeRemaining?: number;
  timerPaused?: boolean;
}

export interface HostLocalSecretPayload {
  playerId: string;
  playerName: string;
  secret: PlayerSecret;
}

export interface VoteStatePayload {
  targetPlayerId?: string;
}

export interface PlayerSecretEnvelope {
  playerId: string;
  secret: PlayerSecret;
}

export interface ClientToServerEvents {
  'room:create': (payload: { mode: Mode; name: string; playerToken?: string; wordLocale?: WordLocale }) => void;
  'room:join': (payload: { roomCode: string; name: string; playerToken?: string }) => void;
  'room:watch': (payload: { roomCode: string }) => void;
  'presence:heartbeat': () => void;
  'room:ready': (payload: { ready: boolean }) => void;
  'reveal:opened': () => void;
  'host:addLocalPlayer': (payload: { name: string; hostKey: string }) => void;
  'host:removeLocalPlayer': (payload: { playerId: string; hostKey: string }) => void;
  'host:renameLocalPlayer': (payload: { playerId: string; name: string; hostKey: string }) => void;
  'host:configure': (payload: { settings: Settings; wordSource: WordSource; hostKey: string }) => void;
  'host:start': (payload: { hostKey: string }) => void;
  'host:nextReveal': (payload: { hostKey: string }) => void;
  'host:closeReveal': (payload: { hostKey: string }) => void;
  'turn:next': (payload: { hostKey: string }) => void;
  'host:pauseTimer': (payload: { hostKey: string }) => void;
  'host:resumeTimer': (payload: { hostKey: string }) => void;
  'vote:cast': (payload: { targetPlayerId: string }) => void;
  'host:voteForPlayer': (payload: { voterPlayerId: string; targetPlayerId: string; hostKey: string }) => void;
  'host:nextWord': (payload: { hostKey: string }) => void;
  'vote:close': (payload: { hostKey: string }) => void;
  'host:advanceResolve': (payload: { hostKey: string; startNextWord?: boolean }) => void;
  'host:markRevealOpened': (payload: { playerId: string; hostKey: string }) => void;
  'host:resumeAfterIdle': (payload: { hostKey: string }) => void;
  'host:transferHost': (payload: { targetPlayerId: string; hostKey: string }) => void;
  'mrwhite:guess': (payload: { guess: string }) => void;
  'host:requestLocalSecret': (payload: { playerId: string; hostKey: string }) => void;
  'host:resetRoom': (payload: { hostKey: string }) => void;
  'host:closeRoom': (payload: { hostKey: string }) => void;
}

export interface ServerToClientEvents {
  'room:created': (payload: RoomCreatedPayload) => void;
  'room:joined': (payload: RoomJoinedPayload) => void;
  'room:state_public': (payload: { roomPublicState: RoomPublicState }) => void;
  'player:secret': (payload: PlayerSecretEnvelope) => void;
  'phase:update': (payload: { status: Status }) => void;
  'turn:update': (payload: TurnUpdatePayload) => void;
  'vote:update': (payload: VoteUpdatePayload) => void;
  'vote:state': (payload: VoteStatePayload) => void;
  'resolve:elimination': (payload: EliminationResult) => void;
  'game:end': (payload: GameEndPayload) => void;
  'server:error': (payload: ServerError) => void;
  'mrwhite:guess_prompt': (payload: { maskedWordHintLength: number }) => void;
  'host:localSecret': (payload: HostLocalSecretPayload) => void;
  'host:granted': (payload: { hostKey: string }) => void;
}
