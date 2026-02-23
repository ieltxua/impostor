import { t } from '../i18n';

interface TurnBannerProps {
  speakerName?: string;
  timeRemaining?: number;
  timerPaused?: boolean;
}

export function TurnBanner({ speakerName, timeRemaining, timerPaused = false }: TurnBannerProps) {
  return (
    <div className="turn-focus" data-testid="discussion-turn-banner">
      <p className="turn-focus__label">{t('turn.currentTurnTitle')}</p>
      <p className="turn-focus__speaker" data-testid="discussion-current-speaker">
        {speakerName ?? t('turn.pending')}
      </p>
      <p className="turn-focus__time" data-testid="discussion-timer">
        <span>{t('turn.timeRemainingLabel')}</span>
        <strong>
          {timeRemaining ?? t('turn.manual')}
          {timeRemaining !== undefined && timerPaused ? ` (${t('turn.paused')})` : ''}
        </strong>
      </p>
    </div>
  );
}
