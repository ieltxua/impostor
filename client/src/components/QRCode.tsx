import { useEffect, useMemo, useState } from 'react';

import { toDataURL } from 'qrcode';

import { buildInviteJoinPath, resolveRouteContext } from '../routing/routeContext';
import { t } from '../i18n';

interface QRCodeProps {
  roomCode: string;
}

export function QRCode({ roomCode }: QRCodeProps) {
  const routeContext = useMemo(() => resolveRouteContext(window.location.pathname, import.meta.env.BASE_URL), []);
  const joinUrl = useMemo(() => {
    const url = new URL(window.location.origin);
    url.pathname = buildInviteJoinPath(routeContext, roomCode);
    return url.toString();
  }, [roomCode, routeContext]);
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQrError(false);

    void toDataURL(joinUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 260
    })
      .then((dataUrl: string) => {
        if (!cancelled) {
          setQrImageUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrImageUrl('');
          setQrError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  return (
    <section className="card stack-sm">
      <h4 className="section-title section-title--sm">{t('qr.title')}</h4>
      <p className="meta-line">
        {t('qr.sharePrefix', { roomCode })} {t('qr.orLink')}
      </p>
      <div className="qr-preview" data-testid="invite-qr">
        {qrImageUrl && <img className="qr-image" src={qrImageUrl} alt={t('qr.imageAlt', { roomCode })} />}
        {!qrImageUrl && !qrError && <p className="meta-line">{t('qr.generating')}</p>}
        {qrError && <p className="meta-line">{t('qr.unavailable')}</p>}
      </div>
      <code className="invite-link">{joinUrl}</code>
    </section>
  );
}
