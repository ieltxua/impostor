import type { PlayerPublic } from '@impostor/shared';

interface VotePanelProps {
  players: PlayerPublic[];
  currentPlayerId?: string;
  onVote: (targetPlayerId: string) => void;
}

export function VotePanel({ players, currentPlayerId, onVote }: VotePanelProps) {
  const alivePlayers = players.filter((player) => player.alive);

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }} data-testid="vote-panel">
      <h4 style={{ marginTop: 0 }}>Vote</h4>
      <p style={{ marginTop: 0 }}>Choose one alive player.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {alivePlayers.map((player) => (
          <button
            key={player.id}
            type="button"
            disabled={player.id === currentPlayerId}
            onClick={() => onVote(player.id)}
            style={{ minHeight: 44 }}
            data-testid={`vote-target-${player.id}`}
          >
            {player.name}
          </button>
        ))}
      </div>
    </section>
  );
}
