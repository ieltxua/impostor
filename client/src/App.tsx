import { useEffect, useMemo } from 'react';

import { ThemeToggle } from './components/ThemeToggle';
import logoMark from './assets/logo-mark.png';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';
import { Public } from './pages/Public';
import { buildVariantHref, resolveInviteRoomCode, resolveRouteContext } from './routing/routeContext';
import { formatStatus, t } from './i18n';
import { useRoomStore } from './state/roomStore';
import { useTheme } from './theme/useTheme';

export function App() {
  const room = useRoomStore();
  const { preference, setPreference } = useTheme();
  const routeContext = useMemo(() => resolveRouteContext(window.location.pathname, import.meta.env.BASE_URL), []);

  const initialRoomCode = useMemo(
    () => resolveInviteRoomCode(window.location.pathname, window.location.search, import.meta.env.BASE_URL),
    []
  );
  const isPublicRoute = routeContext.appPath === '/public';

  const currentSearch = window.location.search;
  const v1Href = buildVariantHref(routeContext, 'v1', currentSearch);
  const v3Href = buildVariantHref(routeContext, 'v3', currentSearch);

  useEffect(() => {
    document.documentElement.setAttribute('data-style-variant', routeContext.styleVariant);
  }, [routeContext.styleVariant]);

  useEffect(() => {
    document.title = t('app.title');
  }, []);

  useEffect(() => {
    if (!isPublicRoute || !initialRoomCode || !room.connected) {
      return;
    }
    room.watchRoom(initialRoomCode);
  }, [initialRoomCode, isPublicRoute, room.connected]);

  const showHome = !room.publicState;
  const hasInviteEntry = showHome && Boolean(initialRoomCode);
  const showCompactHeader = !isPublicRoute && (!showHome || hasInviteEntry);
  const connectionStatusMessage = room.error
    ? `${room.error.code}: ${room.error.message}`
    : room.connected
      ? t('app.connectionHealthy')
      : t('app.connectionReconnecting');

  return (
    <div className={`app-root ${isPublicRoute ? 'app-root--public' : ''}`}>
      <header className={`app-header card ${showCompactHeader ? 'app-header--compact' : ''}`}>
        {!showCompactHeader ? (
          <div className="app-top-bar">
            <div className="app-title-wrap">
              <h1 className="app-title app-title--with-logo">
                <img src={logoMark} alt={t('app.title')} className="app-logo" />
                <span>{t('app.title')}</span>
              </h1>
              <p className="app-subtitle">
                {isPublicRoute ? t('app.subtitlePublicBoard') : t('app.subtitlePrivateControl')} |{' '}
                {t('app.styleLabel', { style: routeContext.styleVariant.toUpperCase() })}
              </p>
              <div className="variant-switch">
                <a
                  className={`variant-chip ${routeContext.styleVariant === 'v1' ? 'variant-chip--active' : ''}`}
                  href={v1Href}
                >
                  {t('app.routeV1')}
                </a>
                <a
                  className={`variant-chip ${routeContext.styleVariant === 'v3' ? 'variant-chip--active' : ''}`}
                  href={v3Href}
                >
                  {t('app.routeV3')}
                </a>
              </div>
            </div>
            <ThemeToggle preference={preference} onChange={setPreference} />
          </div>
        ) : null}

        <p className="status-line" data-testid="app-connection-status">
          <span className={`status-pill ${room.connected ? 'status-pill--connected' : 'status-pill--disconnected'}`}>
            {room.connected ? t('app.statusConnected') : t('app.statusDisconnected')}
          </span>
          {connectionStatusMessage}
        </p>
        {showCompactHeader && room.publicState && (
          <p className="meta-line app-compact-room" data-testid="app-compact-room">
            {room.publicState.code} | {formatStatus(room.publicState.status)}
          </p>
        )}
      </header>

      {isPublicRoute ? (
        <Public roomState={room.publicState} />
      ) : (
        <>
          {showHome && (
            <Home
              initialRoomCode={initialRoomCode}
              onCreateRoom={room.createRoom}
              onJoinRoom={room.joinRoom}
            />
          )}

              {!showHome && room.publicState?.status === 'LOBBY' && (
            <Lobby
              roomState={room.publicState}
              playerId={room.playerId}
              isHost={room.isHost}
              onReady={room.toggleReady}
              onAddLocalPlayer={room.addLocalPlayer}
              onRemoveLocalPlayer={room.removeLocalPlayer}
              onRenameLocalPlayer={room.renameLocalPlayer}
              onConfigure={room.configureRoom}
              onStart={room.startGame}
              onCloseRoom={room.closeCreatedRoom}
            />
          )}

          {!showHome && room.publicState && room.publicState.status !== 'LOBBY' && (
            <Game
              roomState={room.publicState}
              secret={room.secret}
              localSecretPreview={room.localSecretPreview}
              gameEnd={room.gameEnd}
              playerId={room.playerId}
              isHost={room.isHost}
              mrWhitePrompt={room.mrWhitePrompt}
              myVoteTargetId={room.myVoteTargetId}
              onCloseReveal={room.closeReveal}
              onNextReveal={room.nextReveal}
              onRequestLocalSecret={room.requestLocalSecret}
              onRevealOpened={room.revealOpened}
              onMarkRevealOpenedForPlayer={room.markRevealOpenedForPlayer}
              onNextTurn={room.nextTurn}
              onPauseTimer={room.pauseTimer}
              onResumeTimer={room.resumeTimer}
              onCastVote={room.castVote}
              onCastVoteForPlayer={room.castVoteForPlayer}
              onNextWord={room.nextWord}
              onAdvanceResolve={room.advanceResolve}
              onCloseVote={room.closeVote}
              onResumeAfterIdle={room.resumeAfterIdle}
              onCloseRoom={room.closeCreatedRoom}
              onTransferHost={room.transferHost}
              onGuess={room.guessWord}
              onReset={room.resetRoom}
            />
          )}
        </>
      )}
    </div>
  );
}
