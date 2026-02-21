import type {
  EliminationResult,
  Mode,
  PlayerSecret,
  RoomPublicState,
  Settings,
  Status,
  Winner,
  WordPair
} from './room.js';

export interface WordSourceRandom {
  type: 'RANDOM';
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
    | 'HOST_DISCONNECTED';
  message: string;
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
}

export interface ClientToServerEvents {
  'room:create': (payload: { mode: Mode; name: string; playerToken?: string }) => void;
  'room:join': (payload: { roomCode: string; name: string; playerToken?: string }) => void;
  'room:watch': (payload: { roomCode: string }) => void;
  'room:ready': (payload: { ready: boolean }) => void;
  'host:configure': (payload: { settings: Settings; wordSource: WordSource; hostKey: string }) => void;
  'host:start': (payload: { hostKey: string }) => void;
  'host:closeReveal': (payload: { hostKey: string }) => void;
  'turn:next': (payload: { hostKey: string }) => void;
  'vote:cast': (payload: { targetPlayerId: string }) => void;
  'vote:close': (payload: { hostKey: string }) => void;
  'mrwhite:guess': (payload: { guess: string }) => void;
  'host:resetRoom': (payload: { hostKey: string }) => void;
}

export interface ServerToClientEvents {
  'room:created': (payload: RoomCreatedPayload) => void;
  'room:joined': (payload: RoomJoinedPayload) => void;
  'room:state_public': (payload: { roomPublicState: RoomPublicState }) => void;
  'player:secret': (payload: PlayerSecret) => void;
  'phase:update': (payload: { status: Status }) => void;
  'turn:update': (payload: TurnUpdatePayload) => void;
  'vote:update': (payload: VoteUpdatePayload) => void;
  'resolve:elimination': (payload: EliminationResult) => void;
  'game:end': (payload: GameEndPayload) => void;
  'server:error': (payload: ServerError) => void;
  'mrwhite:guess_prompt': (payload: { maskedWordHintLength: number }) => void;
}
