import { useEffect, useMemo, useState } from 'react';

import {
  localizeCategory,
  type GameEndPayload,
  type HostLocalSecretPayload,
  type PlayerSecret,
  type RoomPublicState
} from '@impostor/shared';

import { formatRole, formatStatus, formatWinner, getLocale, t } from '../i18n';
import { SecretCard } from '../components/SecretCard';
import { TurnBanner } from '../components/TurnBanner';
import { VotePanel } from '../components/VotePanel';

interface GameProps {
  roomState: RoomPublicState;
  secret?: PlayerSecret;
  localSecretPreview?: HostLocalSecretPayload;
  gameEnd?: GameEndPayload;
  playerId?: string;
  isHost: boolean;
  mrWhitePrompt?: { maskedWordHintLength: number };
  myVoteTargetId?: string;
  onCloseReveal: () => void;
  onNextReveal: () => void;
  onRequestLocalSecret: (playerId: string) => void;
  onRevealOpened: () => void;
  onMarkRevealOpenedForPlayer: (playerId: string) => void;
  onNextTurn: () => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onCastVote: (targetPlayerId: string) => void;
  onCastVoteForPlayer: (voterPlayerId: string, targetPlayerId: string) => void;
  onNextWord: () => void;
  onAdvanceResolve: (startNextWord?: boolean) => void;
  onCloseVote: () => void;
  onResumeAfterIdle: () => void;
  onCloseRoom: () => void;
  onTransferHost: (targetPlayerId: string) => void;
  onGuess: (guess: string) => void;
  onReset: () => void;
}

export function Game({
  roomState,
  secret,
  localSecretPreview,
  gameEnd,
  playerId,
  isHost,
  mrWhitePrompt,
  myVoteTargetId,
  onCloseReveal,
  onNextReveal,
  onRequestLocalSecret,
  onRevealOpened,
  onMarkRevealOpenedForPlayer,
  onNextTurn,
  onPauseTimer,
  onResumeTimer,
  onCastVote,
  onCastVoteForPlayer,
  onNextWord,
  onAdvanceResolve,
  onCloseVote,
  onResumeAfterIdle,
  onCloseRoom,
  onTransferHost,
  onGuess,
  onReset
}: GameProps) {
  const speakerName = useMemo(
    () => roomState.playersPublic.find((player) => player.id === roomState.currentSpeakerId)?.name,
    [roomState.currentSpeakerId, roomState.playersPublic]
  );
  const currentRevealPlayer = useMemo(
    () => roomState.playersPublic.find((player) => player.id === roomState.currentRevealPlayerId),
    [roomState.currentRevealPlayerId, roomState.playersPublic]
  );
  const nextRevealPlayer = useMemo(
    () => roomState.playersPublic.find((player) => player.id === roomState.nextRevealPlayerId),
    [roomState.nextRevealPlayerId, roomState.playersPublic]
  );
  const isLiveRevealTurn = roomState.status === 'REVEAL' && roomState.mode === 'LIVE';
  const hasLocalOnlyPlayers = roomState.playersPublic.some((player) => player.isLocalOnly);
  const hasConnectedRemoteDevicePlayers = roomState.playersPublic.some(
    (player) => player.alive && player.connected && !player.isLocalOnly && !player.isHost
  );
  const isLiveRevealWithLocalPlayers = isLiveRevealTurn && hasLocalOnlyPlayers;
  const hostManagedLocalRevealFlow =
    isLiveRevealWithLocalPlayers && (isHost || !hasConnectedRemoteDevicePlayers);
  const isCurrentRevealPlayer = isLiveRevealTurn && Boolean(roomState.currentRevealPlayerId && roomState.currentRevealPlayerId === playerId);
  const hasNextRevealPlayer = roomState.nextRevealPlayerId != null;
  const revealAttemptCounts = roomState.revealAttemptCountsByPlayerId ?? {};
  const canHostSeeLocalReveal =
    isHost && hostManagedLocalRevealFlow && (currentRevealPlayer?.isLocalOnly ?? false);
  const currentRevealSecretForHost =
    canHostSeeLocalReveal &&
    localSecretPreview?.playerId === currentRevealPlayer?.id
      ? localSecretPreview?.secret
      : undefined;
  const revealSecretSource =
    hostManagedLocalRevealFlow && currentRevealPlayer?.isLocalOnly ? currentRevealSecretForHost : secret;
  const shouldRevealOwnLiveSecret =
    !hostManagedLocalRevealFlow ||
    isCurrentRevealPlayer ||
    canHostSeeLocalReveal;
  const showCurrentRevealSecret = shouldRevealOwnLiveSecret;
  const revealSecret = isLiveRevealTurn ? (showCurrentRevealSecret ? revealSecretSource : undefined) : secret;
  const revealLocked = isLiveRevealTurn && hostManagedLocalRevealFlow ? !showCurrentRevealSecret : false;
  const shouldShowRevealAttempts = isHost && hostManagedLocalRevealFlow;
  const currentRevealAttemptCount = currentRevealPlayer ? revealAttemptCounts[currentRevealPlayer.id] ?? 0 : 0;
  const alivePlayers = useMemo(() => roomState.playersPublic.filter((player) => player.alive), [roomState.playersPublic]);
  const pendingRevealPlayers = useMemo(
    () => alivePlayers.filter((player) => (revealAttemptCounts[player.id] ?? 0) < 1),
    [alivePlayers, revealAttemptCounts]
  );
  const pendingRevealCount = roomState.status === 'REVEAL' ? pendingRevealPlayers.length : 0;
  const hasSingleDevicePlayers = roomState.mode === 'LIVE' && roomState.playersPublic.every((player) => player.isHost || player.isLocalOnly);
  const hasLocalAlivePlayers = alivePlayers.some((player) => player.isLocalOnly);
  const showHostVoteCollector = isHost && (hasSingleDevicePlayers || hasLocalAlivePlayers);
  const manualVotePlayers = useMemo(
    () =>
      showHostVoteCollector
        ? hasSingleDevicePlayers
          ? alivePlayers
          : alivePlayers.filter((player) => player.isLocalOnly)
        : [],
    [showHostVoteCollector, hasSingleDevicePlayers, alivePlayers]
  );
  const aliveTargetsByVoter = useMemo(() => {
    return new Map(
      manualVotePlayers.map((voter) => [voter.id, alivePlayers.filter((target) => target.id !== voter.id)])
    );
  }, [alivePlayers, manualVotePlayers]);
  const votedSet = useMemo(() => new Set(roomState.votedPlayerIds ?? []), [roomState.votedPlayerIds]);
  const eliminatedPlayer = roomState.playersPublic.find(
    (player) => player.id === roomState.lastElimination?.eliminatedPlayerId
  );
  const eliminationRole = roomState.lastElimination?.revealedRole;
  const eliminationRoleLabel = eliminationRole ? formatRole(eliminationRole) : t('game.pendingTag');
  const eliminatedName = eliminatedPlayer?.name ?? t('game.unknownTarget');
  const eliminationResultKey = (
    eliminationRole
      ? {
          CIVIL: 'game.resolveCivilEliminated',
          UNDERCOVER: 'game.resolveUndercoverEliminated',
          MR_WHITE: 'game.resolveMrWhiteEliminated'
        }[eliminationRole]
      : 'game.resolveUnknownEliminated'
  ) as Parameters<typeof t>[0];
  const eliminationResultLine = eliminationRole
    ? t(eliminationResultKey, { playerName: eliminatedName })
    : t('game.resolveUnknownEliminated', { playerName: eliminatedName });
  const hasImmediateWinner = Boolean(roomState.resolveOutcome);
  const resolveResultLine = hasImmediateWinner
    ? t('game.resolveResultTitle', { winner: formatWinner(roomState.resolveOutcome!.winner) })
    : t('game.resolveStatusTitle');
  const resolveActionLabel = hasImmediateWinner ? t('game.resolveRestartAction') : t('game.resolveContinueAction');
  const resolveActionHint = hasImmediateWinner ? t('game.resolveRestartHint') : t('game.resolveContinueHint');
  const canHostAdvanceResolve = isHost && roomState.status === 'RESOLVE';
  const resumePromptRequired = roomState.resumePromptRequired === true;
  const resumeIdleMinutes = roomState.resumeIdleMinutes ?? 10;
  const pendingHostTransferPlayerName = useMemo(
    () => roomState.playersPublic.find((player) => player.id === roomState.pendingHostTransferToPlayerId)?.name,
    [roomState.pendingHostTransferToPlayerId, roomState.playersPublic]
  );
  const hostTransferCandidates = useMemo(
    () =>
      roomState.playersPublic.filter(
        (player) => !player.isHost && !player.isLocalOnly && player.connected
      ),
    [roomState.playersPublic]
  );
  const canReviewOwnSecret =
    Boolean(secret) &&
    roomState.status !== 'REVEAL' &&
    !(roomState.mode === 'LIVE' && hasLocalOnlyPlayers);
  const [secretReviewOpen, setSecretReviewOpen] = useState(false);

  const [guess, setGuess] = useState('');
  const [localVoteTargets, setLocalVoteTargets] = useState<Record<string, string>>({});
  const [transferTargetPlayerId, setTransferTargetPlayerId] = useState('');
  const [endGameConfirmOpen, setEndGameConfirmOpen] = useState(false);

  const liveRevealHint = hostManagedLocalRevealFlow && currentRevealPlayer
    ? hasNextRevealPlayer
      ? `${t('game.revealTurnLabel', { playerName: currentRevealPlayer.name })} ${t('game.revealPassToLabel', {
          playerName: nextRevealPlayer?.name ?? ''
        })}`
      : t('game.revealTurnLabel', { playerName: currentRevealPlayer.name })
    : isLiveRevealTurn
      ? t('game.currentRevealLabel')
      : t('game.revealHint');

  const revealFooter = hostManagedLocalRevealFlow && isHost && !hasNextRevealPlayer ? t('game.nextRevealMissingLabel') : undefined;
  const shouldShowNextRevealButton = isHost && hostManagedLocalRevealFlow && hasNextRevealPlayer;
  const nextRevealButtonReady = currentRevealAttemptCount > 0;

  useEffect(() => {
    if (roomState.status !== 'VOTE') {
      setLocalVoteTargets({});
    }
  }, [roomState.status]);

  useEffect(() => {
    if (!canReviewOwnSecret) {
      setSecretReviewOpen(false);
    }
  }, [canReviewOwnSecret, roomState.status]);

  useEffect(() => {
    if (!isHost && endGameConfirmOpen) {
      setEndGameConfirmOpen(false);
    }
  }, [endGameConfirmOpen, isHost]);

  useEffect(() => {
    if (hostTransferCandidates.length === 0) {
      setTransferTargetPlayerId('');
      return;
    }
    if (!hostTransferCandidates.some((player) => player.id === transferTargetPlayerId)) {
      setTransferTargetPlayerId(hostTransferCandidates[0].id);
    }
  }, [hostTransferCandidates, transferTargetPlayerId]);

  useEffect(() => {
    if (!isHost || !hostManagedLocalRevealFlow || !currentRevealPlayer?.isLocalOnly) {
      return;
    }
    if (localSecretPreview?.playerId === currentRevealPlayer.id) {
      return;
    }
    onRequestLocalSecret(currentRevealPlayer.id);
  }, [
    currentRevealPlayer?.id,
    currentRevealPlayer?.isLocalOnly,
    hostManagedLocalRevealFlow,
    isHost,
    localSecretPreview?.playerId,
    onRequestLocalSecret
  ]);

  return (
    <main className="layout-grid game-grid" data-testid="game-screen">
      <h2 className="page-title" data-testid="game-status">
        {t('game.pageTitle', { code: roomState.code, status: formatStatus(roomState.status) })}
      </h2>

      {resumePromptRequired && (
        <section className="resolve-overlay" aria-live="polite" data-testid="resume-idle-overlay">
          <div className="card stack-sm resolve-modal">
            <h4 className="section-title section-title--sm">{t('game.resumePromptTitle')}</h4>
            <p className="meta-line">{t('game.resumePromptBody', { minutes: resumeIdleMinutes })}</p>
            {isHost ? (
              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary button-large"
                  onClick={onResumeAfterIdle}
                  data-testid="resume-idle-continue"
                >
                  {t('game.resumePromptContinue')}
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={onCloseRoom}
                  data-testid="resume-idle-close-room"
                >
                  {t('game.resumePromptCloseRoom')}
                </button>
              </div>
            ) : (
              <p className="meta-line">{t('game.resumePromptWaitingHost')}</p>
            )}
          </div>
        </section>
      )}

      {canReviewOwnSecret && (
        <button
          type="button"
          className="button button-secondary"
          data-testid="my-secret-open"
          onClick={() => setSecretReviewOpen(true)}
        >
          {t('game.mySecretAction')}
        </button>
      )}

      {isHost && (
        <section className="card stack-sm" data-testid="host-match-controls">
          <h4 className="section-title section-title--sm">{t('game.hostMatchControlsTitle')}</h4>
          {pendingHostTransferPlayerName ? (
            <p className="meta-line" data-testid="host-transfer-pending">
              {t('game.hostTransferPending', { playerName: pendingHostTransferPlayerName })}
            </p>
          ) : null}
          <div className="inline-row">
            <select
              value={transferTargetPlayerId}
              onChange={(event) => setTransferTargetPlayerId(event.target.value)}
              data-testid="host-transfer-target"
              disabled={hostTransferCandidates.length === 0}
            >
              {hostTransferCandidates.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button-secondary"
              data-testid="host-transfer-submit"
              disabled={!transferTargetPlayerId}
              onClick={() => {
                if (!transferTargetPlayerId) {
                  return;
                }
                onTransferHost(transferTargetPlayerId);
              }}
            >
              {t('game.hostTransferAction')}
            </button>
          </div>
          <p className="meta-line">{t('game.hostTransferHint')}</p>
          <button
            type="button"
            className="button button-ghost"
            data-testid="host-end-game-now"
            onClick={() => setEndGameConfirmOpen(true)}
          >
            {t('game.hostEndGameAction')}
          </button>
        </section>
      )}

      {isHost && endGameConfirmOpen && (
        <section className="resolve-overlay" aria-live="polite" data-testid="host-end-game-confirm">
          <div className="card stack-sm resolve-modal">
            <h4 className="section-title section-title--sm">{t('game.hostEndGameConfirmTitle')}</h4>
            <p className="meta-line">{t('game.hostEndGameConfirmBody')}</p>
            <div className="button-row">
              <button
                type="button"
                className="button button-secondary"
                data-testid="host-end-game-cancel"
                onClick={() => setEndGameConfirmOpen(false)}
              >
                {t('game.hostEndGameConfirmCancel')}
              </button>
              <button
                type="button"
                className="button button-ghost"
                data-testid="host-end-game-confirm-action"
                onClick={onCloseRoom}
              >
                {t('game.hostEndGameConfirmAction')}
              </button>
            </div>
          </div>
        </section>
      )}

      {roomState.status === 'REVEAL' && (
        <section className="card stack-sm reveal-panel" data-testid="live-reveal-panel">
          <div className="reveal-player-row">
            <p className="section-title section-title--sm" data-testid="live-reveal-player">
              {hostManagedLocalRevealFlow && currentRevealPlayer
                ? t('game.currentRevealHeading', { playerName: currentRevealPlayer.name })
                : t('game.currentRevealLabel')}
            </p>
            {shouldShowRevealAttempts && (
              <p className="reveal-attempt-count meta-line" data-testid="live-reveal-attempts">
                {t('game.revealAttemptCountLabel', { count: currentRevealAttemptCount })}
              </p>
            )}
          </div>
          {hostManagedLocalRevealFlow && (
            <p className="meta-line">{liveRevealHint}</p>
          )}
          <SecretCard
            secret={revealSecret}
            revealLocked={revealLocked}
            hiddenHint={t('secret.revealLockedByTurnHint')}
            onReveal={() => {
              if (roomState.status !== 'REVEAL') {
                return;
              }

              if (isHost && hostManagedLocalRevealFlow && currentRevealPlayer?.id) {
                onMarkRevealOpenedForPlayer(currentRevealPlayer.id);
                return;
              }

              onRevealOpened();
            }}
          />
          {hostManagedLocalRevealFlow && isHost && revealFooter && <p className="meta-line">{revealFooter}</p>}
          {isHost && pendingRevealCount > 0 && (
            <p className="meta-line" data-testid="host-reveal-pending-count">
              {t('game.revealPendingCountLabel', { count: pendingRevealCount })}
            </p>
          )}
          <div className="button-row">
            {shouldShowNextRevealButton && (
              <button
                type="button"
                className="button button-primary button-large"
                onClick={onNextReveal}
                disabled={!nextRevealButtonReady}
                data-testid="host-next-reveal"
              >
                {t('game.nextRevealAction')}
              </button>
            )}
            {isHost && (
              <button
                type="button"
                className="button button-ghost"
                onClick={onCloseReveal}
                disabled={pendingRevealCount > 0}
                data-testid="host-close-reveal"
              >
                {t('game.closeRevealAction')}
              </button>
            )}
          </div>
        </section>
      )}

      {roomState.status === 'CLUES' && (
        <section className="card stack-sm discussion-stage" data-testid="discussion-stage">
          <TurnBanner speakerName={speakerName} timeRemaining={roomState.timeRemaining} timerPaused={roomState.timerPaused} />
          {isHost && (
            <button
              type="button"
              className="button button-primary button-large discussion-main-action"
              onClick={onNextTurn}
              data-testid="host-next-turn"
            >
              {t('game.nextTurnAction')}
            </button>
          )}
          {isHost && roomState.timeRemaining !== undefined && (
            <button
              type="button"
              className="button button-secondary"
              onClick={roomState.timerPaused ? onResumeTimer : onPauseTimer}
              data-testid={roomState.timerPaused ? 'host-resume-timer' : 'host-pause-timer'}
            >
              {roomState.timerPaused ? t('game.resumeTimerAction') : t('game.pauseTimerAction')}
            </button>
          )}
          {!isHost && <p className="meta-line discussion-host-note">{t('game.hostControlsTurnHint')}</p>}
        </section>
      )}

      {roomState.status === 'VOTE' && (
        <>
          <p className="meta-line vote-progress" data-testid="vote-progress">
            {t('game.votesProgress', {
              votesCast: roomState.votesCast ?? 0,
              votesTotal: roomState.votesTotal ?? 0
            })}
          </p>
          {!hasSingleDevicePlayers && (
            <VotePanel
              players={roomState.playersPublic}
              currentPlayerId={playerId}
              myVoteTargetId={myVoteTargetId}
              onVote={onCastVote}
            />
          )}
          {showHostVoteCollector && manualVotePlayers.length > 0 && (
            <section className="card stack-sm" data-testid="host-local-vote-panel">
              <h4 className="section-title section-title--sm">{t('game.manualVotingTitle')}</h4>
              <p className="meta-line">
                {hasSingleDevicePlayers ? t('game.hostCollectsVotesBody') : t('game.hostCollectsLocalVotesBody')}
              </p>
              <div className="stack-sm">
                {manualVotePlayers.map((voter) => {
                const targets = aliveTargetsByVoter.get(voter.id) ?? [];
                  const selectedTargetId = localVoteTargets[voter.id] ?? targets[0]?.id ?? '';
                  const hasVoted = votedSet.has(voter.id);
                  const selectedTargetName = targets.find((target) => target.id === selectedTargetId)?.name ?? t('game.unknownTarget');
                  const voterLabel = [
                    voter.name,
                    voter.isLocalOnly ? `(${t('game.localTag')})` : null,
                    hasVoted
                      ? t('game.votedForTag', {
                          playerName: selectedTargetName
                        })
                      : t('game.pendingTag')
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <div key={voter.id} className="field-group stack-sm">
                      <p className="meta-line">{voterLabel}</p>
                      <div className="inline-row">
                        <select
                          value={selectedTargetId}
                          data-testid={`host-local-vote-target-${voter.id}`}
                          onChange={(event) =>
                            setLocalVoteTargets((previous) => ({
                              ...previous,
                              [voter.id]: event.target.value
                            }))
                          }
                        >
                          {targets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="button button-secondary"
                          data-testid={`host-local-vote-submit-${voter.id}`}
                          disabled={!selectedTargetId}
                          onClick={() => onCastVoteForPlayer(voter.id, selectedTargetId)}
                        >
                          {hasVoted ? t('game.updateVoteAction') : t('game.castVoteAction')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {hasSingleDevicePlayers && !isHost && !showHostVoteCollector && (
            <p className="meta-line" data-testid="vote-host-collecting-note">
              {t('game.hostCollectingVotesBody')}
            </p>
          )}
          {isHost && (
            <button type="button" className="button button-ghost" onClick={onNextWord} data-testid="host-next-word">
              {t('game.nextWordSkipAction')}
            </button>
          )}
          {isHost && (
            <button type="button" className="button button-secondary" onClick={onCloseVote} data-testid="host-close-vote">
              {t('game.closeVoteAction')}
            </button>
          )}
        </>
      )}

      {roomState.status === 'RESOLVE' && roomState.lastElimination && (
        <section className="resolve-overlay" aria-live="polite">
          <div className="card stack-sm resolve-modal">
            <h4 className="section-title section-title--sm">{t('game.resolveAnnouncementTitle')}</h4>
            <p className="meta-line">
              {t('game.eliminatedLabel')}: <strong>{eliminatedName}</strong> ({eliminationRoleLabel})
            </p>
            <p className="meta-line resolve-result-role">{eliminationResultLine}</p>
            <p className="meta-line resolve-result-title">{resolveResultLine}</p>
            <p className="meta-line resolve-hint">{resolveActionHint}</p>
            {canHostAdvanceResolve ? (
              <button
                type="button"
                className="button button-primary button-large resolve-action"
                onClick={() => onAdvanceResolve(hasImmediateWinner)}
                data-testid="host-advance-resolve"
              >
                {resolveActionLabel}
              </button>
            ) : (
              <p className="meta-line">{t('game.resolveWaitingHost')}</p>
            )}
          </div>
        </section>
      )}

      {mrWhitePrompt && secret?.role === 'MR_WHITE' && (
        <section className="card stack-sm">
          <h4 className="section-title section-title--sm">{t('game.mrWhiteGuessTitle')}</h4>
          <p className="meta-line">{t('game.mrWhiteGuessHint', { letters: mrWhitePrompt.maskedWordHintLength })}</p>
          <div className="inline-row">
            <input value={guess} onChange={(event) => setGuess(event.target.value)} data-testid="mrwhite-guess-input" />
            <button
              type="button"
              className="button button-primary"
              onClick={() => onGuess(guess)}
              data-testid="mrwhite-guess-submit"
            >
              {t('game.mrWhiteGuessSubmit')}
            </button>
          </div>
        </section>
      )}

      {roomState.status === 'END' && gameEnd && (
        <section className="card stack-sm">
          <h4 className="section-title section-title--sm">{t('game.gameEndTitle')}</h4>
          <p className="meta-line">
            {t('game.winnerLabel')}: <strong>{formatWinner(gameEnd.winner)}</strong>
          </p>
          <p className="meta-line">{gameEnd.reason}</p>
          {gameEnd.wordPair.category ? (
            <p className="meta-line">
              {t('game.categoryLabel')}: {localizeCategory(gameEnd.wordPair.category, getLocale())}
            </p>
          ) : null}
          <p className="meta-line">
            {t('game.wordsLabel')}: {gameEnd.wordPair.a} / {gameEnd.wordPair.b}
          </p>
          {isHost && (
            <div className="button-row">
              <button type="button" className="button button-secondary" onClick={onNextWord} data-testid="host-end-next-word">
                {t('game.nextWordAction')}
              </button>
              <button type="button" className="button button-primary" onClick={onReset} data-testid="host-reset-room">
                {t('game.resetRoomAction')}
              </button>
            </div>
          )}
        </section>
      )}

      {canReviewOwnSecret && secretReviewOpen && secret && (
        <section className="resolve-overlay secret-review-overlay" aria-live="polite">
          <div className="card stack-sm resolve-modal secret-review-modal">
            <h4 className="section-title section-title--sm">{t('game.secretReviewTitle')}</h4>
            <p className="meta-line">{t('secret.revealRoleLabel', { role: formatRole(secret.role) })}</p>
            <p className="meta-line">
              {secret.wordOrNull
                ? t('secret.revealWordLabel', { word: secret.wordOrNull })
                : t('secret.noWordAssigned')}
            </p>
            <button
              type="button"
              className="button button-primary"
              data-testid="my-secret-close"
              onClick={() => setSecretReviewOpen(false)}
            >
              {t('game.closeMySecretAction')}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
