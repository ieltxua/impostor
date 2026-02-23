import type { PlayerPublic } from '@impostor/shared';

import { t } from '../i18n';

interface VotePanelProps {
  players: PlayerPublic[];
  currentPlayerId?: string;
  myVoteTargetId?: string;
  onVote: (targetPlayerId: string) => void;
}

export function VotePanel({ players, currentPlayerId, myVoteTargetId, onVote }: VotePanelProps) {
  const alivePlayers = players.filter((player) => player.alive);
  const votedPlayerName = alivePlayers.find((player) => player.id === myVoteTargetId)?.name;
  const hasVoted = Boolean(myVoteTargetId);
  const voteHint = hasVoted
    ? votedPlayerName
      ? t('vote.youVotedFor', { playerName: votedPlayerName })
      : t('vote.youVoted')
    : t('vote.choosePlayerPrompt');
  const voteHelper = hasVoted ? t('vote.chooseAndChange') : t('vote.votePending');

  return (
    <section className="card stack-sm" data-testid="vote-panel">
      <h4 className="section-title section-title--sm">{t('vote.title')}</h4>
      <p className={`meta-line ${hasVoted ? 'vote-status vote-status--done' : 'vote-status'}`}>
        {voteHint}
      </p>
      <p className={`meta-line ${hasVoted ? 'vote-status vote-status--done' : 'vote-status vote-status--pending'}`}>
        {voteHelper}
      </p>
      <div className="vote-grid">
        {alivePlayers.map((player) => (
          <button
            key={player.id}
            type="button"
            disabled={player.id === currentPlayerId}
            onClick={() => onVote(player.id)}
            className={`button button-secondary button-block ${
              player.id === myVoteTargetId ? 'vote-grid__button vote-grid__button--selected' : ''
            }`}
            data-testid={`vote-target-${player.id}`}
            aria-pressed={player.id === myVoteTargetId}
          >
            {player.name}
            {player.id === myVoteTargetId ? ` ${t('vote.selected')}` : ''}
          </button>
        ))}
      </div>
    </section>
  );
}
