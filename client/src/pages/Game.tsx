import { useMemo, useState } from 'react';

import type { GameEndPayload, PlayerSecret, RoomPublicState } from '@impostor/shared';

import { SecretCard } from '../components/SecretCard';
import { TurnBanner } from '../components/TurnBanner';
import { VotePanel } from '../components/VotePanel';

interface GameProps {
  roomState: RoomPublicState;
  secret?: PlayerSecret;
  gameEnd?: GameEndPayload;
  playerId?: string;
  isHost: boolean;
  mrWhitePrompt?: { maskedWordHintLength: number };
  onCloseReveal: () => void;
  onNextTurn: () => void;
  onCastVote: (targetPlayerId: string) => void;
  onCloseVote: () => void;
  onGuess: (guess: string) => void;
  onReset: () => void;
}

export function Game({
  roomState,
  secret,
  gameEnd,
  playerId,
  isHost,
  mrWhitePrompt,
  onCloseReveal,
  onNextTurn,
  onCastVote,
  onCloseVote,
  onGuess,
  onReset
}: GameProps) {
  const speakerName = useMemo(
    () => roomState.playersPublic.find((player) => player.id === roomState.currentSpeakerId)?.name,
    [roomState.currentSpeakerId, roomState.playersPublic]
  );

  const [guess, setGuess] = useState('');

  return (
    <main style={{ display: 'grid', gap: 14 }} data-testid="game-screen">
      <h2 style={{ marginBottom: 0 }} data-testid="game-status">
        Room {roomState.code} - {roomState.status}
      </h2>

      <SecretCard secret={secret} />

      {roomState.status === 'REVEAL' && isHost && (
        <button type="button" onClick={onCloseReveal} style={{ minHeight: 42 }} data-testid="host-close-reveal">
          Close Reveal
        </button>
      )}

      {roomState.status === 'CLUES' && (
        <>
          <TurnBanner speakerName={speakerName} timeRemaining={roomState.timeRemaining} />
          {isHost && roomState.timeRemaining === undefined && (
            <button type="button" style={{ minHeight: 42 }} onClick={onNextTurn} data-testid="host-next-turn">
              Next Turn
            </button>
          )}
        </>
      )}

      {roomState.status === 'VOTE' && (
        <>
          <p style={{ marginBottom: 0 }} data-testid="vote-progress">
            Votes: {roomState.votesCast ?? 0}/{roomState.votesTotal ?? 0}
          </p>
          <VotePanel players={roomState.playersPublic} currentPlayerId={playerId} onVote={onCastVote} />
          {isHost && (
            <button type="button" style={{ minHeight: 42 }} onClick={onCloseVote} data-testid="host-close-vote">
              Close Vote
            </button>
          )}
        </>
      )}

      {roomState.status === 'RESOLVE' && roomState.lastElimination && (
        <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Elimination</h4>
          <p>
            Eliminated: {roomState.lastElimination.eliminatedPlayerId} ({roomState.lastElimination.revealedRole})
          </p>
        </section>
      )}

      {mrWhitePrompt && secret?.role === 'MR_WHITE' && (
        <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Mr White Guess</h4>
          <p>Guess the civilians word ({mrWhitePrompt.maskedWordHintLength} letters).</p>
          <input value={guess} onChange={(event) => setGuess(event.target.value)} data-testid="mrwhite-guess-input" />
          <button type="button" onClick={() => onGuess(guess)} style={{ marginLeft: 8 }} data-testid="mrwhite-guess-submit">
            Submit Guess
          </button>
        </section>
      )}

      {roomState.status === 'END' && gameEnd && (
        <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Game End</h4>
          <p>
            Winner: <strong>{gameEnd.winner}</strong>
          </p>
          <p>{gameEnd.reason}</p>
          <p>
            Words: {gameEnd.wordPair.a} / {gameEnd.wordPair.b}
          </p>
          {isHost && (
            <button type="button" style={{ minHeight: 42 }} onClick={onReset} data-testid="host-reset-room">
              Reset Room
            </button>
          )}
        </section>
      )}
    </main>
  );
}
