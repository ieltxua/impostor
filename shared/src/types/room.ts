export type Role = 'CIVIL' | 'UNDERCOVER' | 'MR_WHITE';
export type Mode = 'LIVE' | 'REMOTE';
export type Status = 'LOBBY' | 'REVEAL' | 'CLUES' | 'VOTE' | 'RESOLVE' | 'END';
export type WinPreset = 'SIMPLE' | 'CLASSIC_GUESS';

export interface RoleCounts {
  civil: number;
  undercover: number;
  mrWhite: number;
}

export interface Settings {
  roleCounts: RoleCounts;
  turnSeconds: number | null;
  allowSecretReviewInRemote: boolean;
  mrWhiteCanGuessOnElim: boolean;
  showVoteTally: boolean;
  winPreset: WinPreset;
}

export interface WordPair {
  a: string;
  b: string;
  category?: string;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  role?: Role;
  assignedWord?: string | null;
  ready: boolean;
  alive: boolean;
  socketId: string;
  playerToken?: string;
}

export interface PlayerPublic {
  id: string;
  name: string;
  ready: boolean;
  alive: boolean;
  isHost: boolean;
}

export interface EliminationResult {
  eliminatedPlayerId: string;
  revealedRole: Role;
}

export interface Room {
  code: string;
  mode: Mode;
  status: Status;
  createdAt: number;
  settings: Settings;
  wordPair: WordPair;
  players: Player[];
  alivePlayerIds: string[];
  roundNumber: number;
  turnOrder: string[];
  currentTurnIndex: number;
  timeRemaining?: number;
  revealAllowed: boolean;
  votes: Record<string, string>;
  lastElimination?: EliminationResult;
}

export interface RoomPublicState {
  code: string;
  mode: Mode;
  status: Status;
  playersPublic: PlayerPublic[];
  roundNumber: number;
  currentSpeakerId?: string;
  timeRemaining?: number;
  votesCast?: number;
  votesTotal?: number;
  lastElimination?: EliminationResult;
}

export interface PlayerSecret {
  role: Role;
  wordOrNull: string | null;
  revealAllowed: boolean;
}

export type Winner = 'CIVILIANS' | 'IMPOSTORS' | 'MR_WHITE_GUESS';
