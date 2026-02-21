import { useEffect, useMemo } from 'react';

import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';
import { Public } from './pages/Public';
import { useRoomStore } from './state/roomStore';

export function App() {
  const room = useRoomStore();

  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialRoomCode = searchParams.get('room')?.toUpperCase();
  const isPublicRoute = window.location.pathname === '/public';

  useEffect(() => {
    if (!isPublicRoute || !initialRoomCode || !room.connected) {
      return;
    }
    room.watchRoom(initialRoomCode);
  }, [initialRoomCode, isPublicRoute, room.connected]);

  if (isPublicRoute) {
    return (
      <div style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
        <Public roomState={room.publicState} />
      </div>
    );
  }

  const showHome = !room.publicState;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16, fontFamily: 'Avenir, Helvetica, Arial, sans-serif' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ marginBottom: 6 }}>Mr. White / Impostor</h1>
        <p style={{ margin: 0 }} data-testid="app-connection-status">
          Status: {room.connected ? 'connected' : 'disconnected'}
          {room.error ? ` | ${room.error.code}: ${room.error.message}` : ''}
        </p>
      </header>

      {showHome && (
        <Home
          initialRoomCode={initialRoomCode}
          onCreateRoom={room.createRoom}
          onJoinRoom={room.joinRoom}
        />
      )}

      {!showHome && room.publicState?.status === 'LOBBY' && (
        <Lobby
          roomState={room.publicState}
          playerId={room.playerId}
          isHost={room.isHost}
          onReady={room.toggleReady}
          onConfigure={room.configureRoom}
          onStart={room.startGame}
        />
      )}

      {!showHome && room.publicState && room.publicState.status !== 'LOBBY' && (
        <Game
          roomState={room.publicState}
          secret={room.secret}
          gameEnd={room.gameEnd}
          playerId={room.playerId}
          isHost={room.isHost}
          mrWhitePrompt={room.mrWhitePrompt}
          onCloseReveal={room.closeReveal}
          onNextTurn={room.nextTurn}
          onCastVote={room.castVote}
          onCloseVote={room.closeVote}
          onGuess={room.guessWord}
          onReset={room.resetRoom}
        />
      )}
    </div>
  );
}
