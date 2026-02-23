export type Role = 'CIVIL' | 'UNDERCOVER' | 'MR_WHITE';
export type Mode = 'LIVE' | 'REMOTE';
export type Status = 'LOBBY' | 'REVEAL' | 'CLUES' | 'VOTE' | 'RESOLVE' | 'END';
export type WinPreset = 'SIMPLE' | 'CLASSIC_GUESS';
export type WordLocale = 'en' | 'es';

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

export interface ResolveOutcome {
  winner: Winner;
  reason: string;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isLocalOnly: boolean;
  connected: boolean;
  lastSeenAt: number;
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
  connected: boolean;
  ready: boolean;
  alive: boolean;
  isHost: boolean;
  isLocalOnly: boolean;
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
  revealAttemptCountsByPlayerId: Record<string, number>;
  timeRemaining?: number;
  timerPaused: boolean;
  revealAllowed: boolean;
  wordLocale: WordLocale;
  votes: Record<string, string>;
  revealPlayerOrder: string[];
  currentRevealPlayerIndex: number;
  currentRevealPlayerId?: string;
  lastElimination?: EliminationResult;
}

export interface RoomPublicState {
  code: string;
  mode: Mode;
  status: Status;
  playersPublic: PlayerPublic[];
  roundNumber: number;
  currentSpeakerId?: string;
  currentRevealPlayerId?: string;
  nextRevealPlayerId?: string;
  revealAttemptCountsByPlayerId?: Record<string, number>;
  timeRemaining?: number;
  timerPaused?: boolean;
  votesCast?: number;
  votesTotal?: number;
  votedPlayerIds?: string[];
  lastElimination?: EliminationResult;
  resolveOutcome?: ResolveOutcome;
  resumePromptRequired?: boolean;
  resumeIdleMinutes?: number;
  pendingHostTransferToPlayerId?: string;
}

export interface PlayerSecret {
  role: Role;
  wordOrNull: string | null;
  revealAllowed: boolean;
}

export type Winner = 'CIVILIANS' | 'IMPOSTORS' | 'MR_WHITE_GUESS';
