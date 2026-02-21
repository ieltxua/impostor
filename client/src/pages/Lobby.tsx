import { useMemo, useState } from 'react';

import type { RoomPublicState, Settings, WordSource } from '@impostor/shared';

import { QRCode } from '../components/QRCode';

interface LobbyProps {
  roomState: RoomPublicState;
  playerId?: string;
  isHost: boolean;
  onReady: (ready: boolean) => void;
  onConfigure: (settings: Settings, wordSource: WordSource) => void;
  onStart: () => void;
}

const DEFAULT_SETTINGS: Settings = {
  roleCounts: { civil: 4, undercover: 1, mrWhite: 1 },
  turnSeconds: 45,
  allowSecretReviewInRemote: true,
  mrWhiteCanGuessOnElim: false,
  showVoteTally: true,
  winPreset: 'SIMPLE'
};

export function Lobby({ roomState, playerId, isHost, onReady, onConfigure, onStart }: LobbyProps) {
  const me = useMemo(() => roomState.playersPublic.find((player) => player.id === playerId), [playerId, roomState.playersPublic]);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [wordA, setWordA] = useState('Pizza');
  const [wordB, setWordB] = useState('Empanada');

  return (
    <main style={{ display: 'grid', gap: 16 }} data-testid="lobby-screen">
      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>
          Lobby <span data-testid="lobby-room-code">{roomState.code}</span>
        </h2>
        <p style={{ margin: 0 }}>Mode: {roomState.mode}</p>
        <p style={{ marginTop: 6 }}>Players: {roomState.playersPublic.length}</p>

        <ul data-testid="lobby-players-list">
          {roomState.playersPublic.map((player) => (
            <li key={player.id} data-testid={`lobby-player-${player.id}`}>
              {player.name} {player.isHost ? '(host)' : ''} {player.ready ? 'ready' : 'not ready'}
            </li>
          ))}
        </ul>

        <button type="button" style={{ minHeight: 42 }} onClick={() => onReady(!me?.ready)} data-testid="lobby-ready-toggle">
          {me?.ready ? 'Mark Not Ready' : 'Mark Ready'}
        </button>

        <QRCode roomCode={roomState.code} />
      </section>

      {isHost && (
        <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }} data-testid="host-settings">
          <h3 style={{ marginTop: 0 }}>Host Settings</h3>
          <label style={{ display: 'grid', gap: 4 }}>
            Civilians
            <input
              type="number"
              min={1}
              value={settings.roleCounts.civil}
              data-testid="host-role-civil"
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, roleCounts: { ...prev.roleCounts, civil: Number(event.target.value) } }))
              }
            />
          </label>

          <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            Undercover
            <input
              type="number"
              min={0}
              value={settings.roleCounts.undercover}
              data-testid="host-role-undercover"
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, roleCounts: { ...prev.roleCounts, undercover: Number(event.target.value) } }))
              }
            />
          </label>

          <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            Mr White
            <input
              type="number"
              min={1}
              max={1}
              value={settings.roleCounts.mrWhite}
              data-testid="host-role-mrwhite"
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, roleCounts: { ...prev.roleCounts, mrWhite: Number(event.target.value) } }))
              }
            />
          </label>

          <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            Turn seconds (0 for manual)
            <input
              type="number"
              min={0}
              value={settings.turnSeconds ?? 0}
              data-testid="host-turn-seconds"
              onChange={(event) => {
                const value = Number(event.target.value);
                setSettings((prev) => ({ ...prev, turnSeconds: value <= 0 ? null : value }));
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            Word A
            <input value={wordA} onChange={(event) => setWordA(event.target.value)} data-testid="host-word-a" />
          </label>
          <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            Word B
            <input value={wordB} onChange={(event) => setWordB(event.target.value)} data-testid="host-word-b" />
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              data-testid="host-apply-config"
              onClick={() =>
                onConfigure(settings, {
                  type: 'CUSTOM',
                  pair: { a: wordA.trim() || 'Pizza', b: wordB.trim() || 'Empanada', category: 'Custom' }
                })
              }
            >
              Apply Config
            </button>
            <button type="button" onClick={onStart} data-testid="host-start-game">
              Start Game
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
