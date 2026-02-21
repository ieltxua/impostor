import type { RoomPublicState } from '@impostor/shared';

interface PublicProps {
  roomState?: RoomPublicState;
}

export function Public({ roomState }: PublicProps) {
  if (!roomState) {
    return <p>Waiting for public room state...</p>;
  }

  const alive = roomState.playersPublic.filter((player) => player.alive).length;
  const eliminated = roomState.playersPublic.length - alive;

  return (
    <main style={{ display: 'grid', gap: 12 }}>
      <h1>Public Board - {roomState.code}</h1>
      <p>Status: {roomState.status}</p>
      <p>
        Round {roomState.roundNumber} | Alive {alive} | Eliminated {eliminated}
      </p>
      <p>
        Current speaker: <strong>{roomState.currentSpeakerId ?? 'N/A'}</strong>
      </p>
      <p>
        Vote progress: {roomState.votesCast ?? 0}/{roomState.votesTotal ?? 0}
      </p>
      {roomState.lastElimination && (
        <p>
          Last elimination: {roomState.lastElimination.eliminatedPlayerId} ({roomState.lastElimination.revealedRole})
        </p>
      )}
    </main>
  );
}
