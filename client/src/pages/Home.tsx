import { useEffect, useState } from 'react';

import { t } from '../i18n';

interface HomeProps {
  initialRoomCode?: string;
  onCreateRoom: (params: { name: string; mode: 'LIVE' }) => void;
  onJoinRoom: (params: { roomCode: string; name: string }) => void;
}

export function Home({ initialRoomCode, onCreateRoom, onJoinRoom }: HomeProps) {
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? '');
  const hasInviteRoomCode = Boolean(initialRoomCode?.trim());

  useEffect(() => {
    if (!initialRoomCode) {
      return;
    }
    setJoinCode(initialRoomCode);
  }, [initialRoomCode]);

  const createFields = (secondary: boolean) => (
    <div className="stack-md">
      <h2 className="section-title">
        {secondary ? t('home.createDifferentRoomTitle') : t('home.createRoomTitle')}
      </h2>
      <label className="form-field">
        {t('home.nameLabel')}
        <input
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          placeholder={t('home.hostNamePlaceholder')}
          data-testid="home-create-name"
          autoFocus={!hasInviteRoomCode}
        />
      </label>
      <button
        type="button"
        className={`button ${secondary ? 'button-secondary' : 'button-primary'} button-block`}
        disabled={!createName.trim()}
        onClick={() => onCreateRoom({ name: createName.trim(), mode: 'LIVE' })}
        data-testid="home-create-submit"
      >
        {t('home.createAction')}
      </button>
    </div>
  );

  const createSection = (
    <section className="card card--interactive stack-md" data-testid="home-create-card">
      {createFields(false)}
    </section>
  );

  const joinSection = (
    <section className={`card card--interactive stack-md ${hasInviteRoomCode ? 'home-join-priority' : ''}`} data-testid="home-join-card">
      <h2 className="section-title">{hasInviteRoomCode ? t('home.inviteJoinTitle') : t('home.joinTitle')}</h2>
      {hasInviteRoomCode && <p className="meta-line">{t('home.inviteJoinSubtitle')}</p>}
      <label className="form-field">
        {t('home.playerNameLabel')}
        <input
          value={joinName}
          onChange={(event) => setJoinName(event.target.value)}
          placeholder={t('home.playerNamePlaceholder')}
          data-testid="home-join-name"
          autoFocus={hasInviteRoomCode}
        />
      </label>
      {!hasInviteRoomCode && (
        <label className="form-field">
          {t('home.roomCodeLabel')}
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder={t('home.roomCodePlaceholder')}
            data-testid="home-join-room-code"
          />
        </label>
      )}
      <button
        type="button"
        className="button button-primary button-block"
        disabled={!joinName.trim() || !joinCode.trim()}
        onClick={() => onJoinRoom({ name: joinName.trim(), roomCode: joinCode.trim() })}
        data-testid="home-join-submit"
      >
        {t('home.joinAction')}
      </button>
    </section>
  );

  return (
    <main className="layout-grid home-grid" data-testid="home-screen">
      {hasInviteRoomCode ? (
        <>
          <section className="card stack-sm home-invite-callout home-invite-priority" data-testid="home-invite-banner">
            <h2 className="section-title section-title--sm">{t('home.inviteDetectedTitle')}</h2>
          </section>
          {joinSection}
        </>
      ) : (
        <>
          {createSection}
          {joinSection}
        </>
      )}
    </main>
  );
}
