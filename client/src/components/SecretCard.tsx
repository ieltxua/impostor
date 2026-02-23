import { type PointerEvent, useEffect, useState } from 'react';

import { formatRole, t } from '../i18n';
import type { PlayerSecret } from '@impostor/shared';

interface SecretCardProps {
  secret?: PlayerSecret;
  revealLocked?: boolean;
  hiddenHint?: string;
  onReveal?: () => void;
}

export function SecretCard({ secret, revealLocked = false, hiddenHint, onReveal }: SecretCardProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [secret, revealLocked]);

  const revealSecret = () => {
    if (!secret?.revealAllowed || revealLocked) {
      return;
    }
    if (revealed) {
      setRevealed(false);
      return;
    }
    setRevealed(true);
    onReveal?.();
  };

  const canReveal = secret?.revealAllowed && !revealLocked;
  const buttonLabel = revealed ? t('secret.hideInstruction') : t('secret.revealInstruction');
  const revealEnabled = canReveal;
  const buttonDisabled = !revealEnabled;
  const roleLine = secret ? t('secret.revealRoleLabel', { role: formatRole(secret.role) }) : '';
  const wordLine = secret
    ? secret.wordOrNull
      ? t('secret.revealWordLabel', { word: secret.wordOrNull })
      : t('secret.noWordAssigned')
    : '';

  const suppressSelection = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      event.preventDefault();
    }
  };

  return (
    <section className={`card secret-card ${revealed ? 'secret-card--revealed' : ''}`}>
      <h3 className="section-title section-title--sm">{t('secret.title')}</h3>
      {!secret && <p className="meta-line">{revealLocked ? hiddenHint || t('secret.locked') : t('secret.waitingRole')}</p>}
      {secret && !canReveal && <p className="meta-line">{t('secret.locked')}</p>}
      {secret && canReveal && (
        <>
          <button
            type="button"
            className="button button-secondary secret-card__button"
            data-testid="secret-reveal-button"
            disabled={buttonDisabled}
            onPointerDown={suppressSelection}
            onContextMenu={(event) => event.preventDefault()}
            onClick={revealSecret}
          >
            {buttonLabel}
          </button>
          <div className="secret-card__content" aria-live="polite">
            {revealed ? (
              <>
                <p className="secret-card__meta secret-card__meta--role">{roleLine}</p>
                <p className="secret-card__meta secret-card__meta--word">{wordLine}</p>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
