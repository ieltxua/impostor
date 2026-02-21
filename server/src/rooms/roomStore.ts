import type { Room, Winner } from '@impostor/shared';
import type { WordSource } from '@impostor/shared';

export interface RoomRuntime extends Room {
  hostKey: string;
  wordSource: WordSource;
  awaitingMrWhiteGuess: boolean;
  pendingWinner?: { winner: Winner; reason: string };
}

const rooms = new Map<string, RoomRuntime>();
const turnTimers = new Map<string, NodeJS.Timeout>();

export function getRoom(code: string): RoomRuntime | undefined {
  return rooms.get(code.toUpperCase());
}

export function setRoom(room: RoomRuntime): void {
  rooms.set(room.code.toUpperCase(), room);
}

export function deleteRoom(code: string): void {
  clearTurnTimer(code);
  rooms.delete(code.toUpperCase());
}

export function listRooms(): RoomRuntime[] {
  return [...rooms.values()];
}

export function clearTurnTimer(code: string): void {
  const key = code.toUpperCase();
  const timer = turnTimers.get(key);
  if (timer) {
    clearInterval(timer);
    turnTimers.delete(key);
  }
}

export function startTurnTimer(code: string, tick: () => void): void {
  const key = code.toUpperCase();
  clearTurnTimer(key);
  turnTimers.set(
    key,
    setInterval(() => {
      tick();
    }, 1000)
  );
}

export function resetRoomStore(): void {
  for (const timer of turnTimers.values()) {
    clearInterval(timer);
  }
  turnTimers.clear();
  rooms.clear();
}
