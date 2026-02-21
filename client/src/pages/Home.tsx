import { useState } from 'react';

import type { Mode } from '@impostor/shared';

interface HomeProps {
  initialRoomCode?: string;
  onCreateRoom: (params: { name: string; mode: Mode }) => void;
  onJoinRoom: (params: { roomCode: string; name: string }) => void;
}

export function Home({ initialRoomCode, onCreateRoom, onJoinRoom }: HomeProps) {
  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<Mode>('LIVE');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? '');

  return (
    <main style={{ display: 'grid', gap: 16 }} data-testid="home-screen">
      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }} data-testid="home-create-card">
        <h2 style={{ marginTop: 0 }}>Create Room</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          Name
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Host name"
            data-testid="home-create-name"
          />
        </label>
        <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          Mode
          <select value={createMode} onChange={(event) => setCreateMode(event.target.value as Mode)} data-testid="home-create-mode">
            <option value="LIVE">LIVE</option>
            <option value="REMOTE">REMOTE</option>
          </select>
        </label>
        <button
          type="button"
          style={{ marginTop: 12, minHeight: 42 }}
          disabled={!createName.trim()}
          onClick={() => onCreateRoom({ name: createName.trim(), mode: createMode })}
          data-testid="home-create-submit"
        >
          Create
        </button>
      </section>

      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }} data-testid="home-join-card">
        <h2 style={{ marginTop: 0 }}>Join Room</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          Name
          <input
            value={joinName}
            onChange={(event) => setJoinName(event.target.value)}
            placeholder="Player name"
            data-testid="home-join-name"
          />
        </label>
        <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          Room code
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="ABCDE"
            data-testid="home-join-room-code"
          />
        </label>
        <button
          type="button"
          style={{ marginTop: 12, minHeight: 42 }}
          disabled={!joinName.trim() || !joinCode.trim()}
          onClick={() => onJoinRoom({ name: joinName.trim(), roomCode: joinCode.trim() })}
          data-testid="home-join-submit"
        >
          Join
        </button>
      </section>
    </main>
  );
}
