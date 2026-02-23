import type { RoomPublicState } from '@impostor/shared';

import { formatRole, formatStatus, t } from '../i18n';

interface PublicProps {
  roomState?: RoomPublicState;
}

export function Public({ roomState }: PublicProps) {
  if (!roomState) {
    return <p className="meta-line">{t('public.waitingState')}</p>;
  }

  const alive = roomState.playersPublic.filter((player) => player.alive).length;
  const eliminated = roomState.playersPublic.length - alive;

  return (
    <main className="layout-grid public-grid">
      <section className="card stack-md">
        <h1 className="section-title">{t('public.boardTitle', { code: roomState.code })}</h1>
        <p className="meta-line">
          {t('public.statusLabel')}: {formatStatus(roomState.status)}
        </p>

        <div className="metric-grid">
          <article className="metric">
            <p className="metric-label">{t('public.roundLabel')}</p>
            <p className="metric-value">{roomState.roundNumber}</p>
          </article>
          <article className="metric">
            <p className="metric-label">{t('public.aliveLabel')}</p>
            <p className="metric-value">{alive}</p>
          </article>
          <article className="metric">
            <p className="metric-label">{t('public.eliminatedLabel')}</p>
            <p className="metric-value">{eliminated}</p>
          </article>
          <article className="metric">
            <p className="metric-label">{t('public.voteProgressLabel')}</p>
            <p className="metric-value">
              {roomState.votesCast ?? 0}/{roomState.votesTotal ?? 0}
            </p>
          </article>
        </div>

        <p className="meta-line">
          {t('public.currentSpeakerLabel')}: <strong>{roomState.currentSpeakerId ?? t('public.notAvailableLabel')}</strong>
        </p>

        {roomState.lastElimination && (
          <p className="meta-line">
            {t('public.lastEliminationLabel')}: {roomState.lastElimination.eliminatedPlayerId} (
            {formatRole(roomState.lastElimination.revealedRole)})
          </p>
        )}
      </section>
    </main>
  );
}
