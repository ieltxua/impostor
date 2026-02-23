import { useEffect, useMemo, useState } from 'react';

import { WORD_DECK_CATEGORIES, localizeCategory, type RoomPublicState, type Settings, type WordSource } from '@impostor/shared';

import { formatMode, getLocale, t } from '../i18n';
import { QRCode } from '../components/QRCode';

interface LobbyProps {
  roomState: RoomPublicState;
  playerId?: string;
  isHost: boolean;
  onReady: (ready: boolean) => void;
  onAddLocalPlayer: (name: string) => void;
  onRemoveLocalPlayer: (playerId: string) => void;
  onRenameLocalPlayer: (playerId: string, name: string) => void;
  onConfigure: (settings: Settings, wordSource: WordSource) => void;
  onStart: () => void;
  onCloseRoom: () => void;
}

const DEFAULT_SETTINGS: Settings = {
  roleCounts: { civil: 4, undercover: 1, mrWhite: 1 },
  turnSeconds: null,
  allowSecretReviewInRemote: true,
  mrWhiteCanGuessOnElim: false,
  showVoteTally: true,
  winPreset: 'SIMPLE'
};

const sanitizeRoleCounts = (roleCounts: Settings['roleCounts'], totalPlayers: number): Settings['roleCounts'] => {
  const mrWhite = Math.max(1, Math.min(Math.floor(roleCounts.mrWhite || 0), Math.max(1, totalPlayers - 1)));
  const maxUndercover = Math.max(0, totalPlayers - mrWhite - 1);
  const undercover = Math.max(0, Math.min(Math.floor(roleCounts.undercover || 0), maxUndercover));
  const civil = totalPlayers - mrWhite - undercover;

  return {
    civil,
    undercover,
    mrWhite
  };
};

interface RoleRecommendation {
  id: 'safe' | 'balanced' | 'chaos';
  roleCounts: Settings['roleCounts'];
}

function buildRoleRecommendation(totalPlayers: number, impostorCount: number): Settings['roleCounts'] {
  const clampedImpostorCount = Math.max(1, Math.min(impostorCount, Math.max(1, totalPlayers - 1)));
  const mrWhiteTarget = totalPlayers >= 10 ? 2 : 1;
  const mrWhite = Math.max(1, Math.min(mrWhiteTarget, clampedImpostorCount));
  const undercover = Math.max(0, clampedImpostorCount - mrWhite);
  const civil = Math.max(1, totalPlayers - clampedImpostorCount);
  return { civil, undercover, mrWhite };
}

function buildRoleRecommendations(totalPlayers: number): RoleRecommendation[] {
  if (totalPlayers < 2) {
    return [];
  }

  const balancedImpostors = totalPlayers <= 4 ? 1 : totalPlayers <= 7 ? 2 : totalPlayers <= 10 ? 3 : 4;
  const safeImpostors = Math.max(1, balancedImpostors - 1);
  const chaosImpostors = Math.min(Math.max(1, totalPlayers - 1), balancedImpostors + 1);

  return [
    { id: 'safe', roleCounts: buildRoleRecommendation(totalPlayers, safeImpostors) },
    { id: 'balanced', roleCounts: buildRoleRecommendation(totalPlayers, balancedImpostors) },
    { id: 'chaos', roleCounts: buildRoleRecommendation(totalPlayers, chaosImpostors) }
  ];
}

export function Lobby({
  roomState,
  playerId,
  isHost,
  onReady,
  onAddLocalPlayer,
  onRemoveLocalPlayer,
  onRenameLocalPlayer,
  onConfigure,
  onStart,
  onCloseRoom
}: LobbyProps) {
  const me = useMemo(() => roomState.playersPublic.find((player) => player.id === playerId), [playerId, roomState.playersPublic]);
  const localPlayers = useMemo(
    () => roomState.playersPublic.filter((player) => player.isLocalOnly && !player.isHost),
    [roomState.playersPublic]
  );

  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingPlayerName, setEditingPlayerName] = useState('');

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [localPlayerName, setLocalPlayerName] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => [...WORD_DECK_CATEGORIES]);

  const totalPlayers = roomState.playersPublic.length;
  const configuredRoleCount =
    settings.roleCounts.civil + settings.roleCounts.undercover + settings.roleCounts.mrWhite;
  const readyForStartCount = roomState.playersPublic.reduce(
    (count, player) => count + ((player.ready && (player.connected || player.isLocalOnly)) ? 1 : 0),
    0
  );
  const canStart = readyForStartCount === configuredRoleCount;
  const roleRecommendations = useMemo(() => buildRoleRecommendations(totalPlayers), [totalPlayers]);

  useEffect(() => {
    const sanitizedRoleCounts = sanitizeRoleCounts(settings.roleCounts, totalPlayers);
    if (
      settings.roleCounts.civil !== sanitizedRoleCounts.civil ||
      settings.roleCounts.undercover !== sanitizedRoleCounts.undercover ||
      settings.roleCounts.mrWhite !== sanitizedRoleCounts.mrWhite
    ) {
      setSettings((prev) => ({
        ...prev,
        roleCounts: sanitizedRoleCounts
      }));
    }
  }, [settings.roleCounts.civil, settings.roleCounts.undercover, settings.roleCounts.mrWhite, totalPlayers]);

  const selectedCategorySet = useMemo(() => new Set(selectedCategories), [selectedCategories]);
  const selectedCategoryCount = selectedCategorySet.size;
  const allCategoriesSelected = selectedCategoryCount === WORD_DECK_CATEGORIES.length;

  const toggleCategory = (category: string) => {
    setSelectedCategories((previous) =>
      previous.includes(category) ? previous.filter((entry) => entry !== category) : [...previous, category]
    );
  };

  const buildWordSource = (): WordSource => {
    const categories = [...selectedCategorySet].map((category) => category.trim()).filter(Boolean);
    return categories.length > 0 ? { type: 'RANDOM', categories } : { type: 'RANDOM' };
  };

  const updateUndercoverCount = (raw: string) => {
    if (!raw.trim()) {
      setSettings((prev) => ({
        ...prev,
        roleCounts: sanitizeRoleCounts({ ...prev.roleCounts, undercover: 0 }, totalPlayers)
      }));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    setSettings((prev) => ({
      ...prev,
      roleCounts: sanitizeRoleCounts({ ...prev.roleCounts, undercover: parsed }, totalPlayers)
    }));
  };

  const updateMrWhiteCount = (raw: string) => {
    if (!raw.trim()) {
      setSettings((prev) => ({
        ...prev,
        roleCounts: sanitizeRoleCounts({ ...prev.roleCounts, mrWhite: 1 }, totalPlayers)
      }));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    setSettings((prev) => ({
      ...prev,
      roleCounts: sanitizeRoleCounts({ ...prev.roleCounts, mrWhite: parsed }, totalPlayers)
    }));
  };

  const updateTurnSeconds = (raw: string) => {
    if (!raw.trim()) {
      setSettings((prev) => ({ ...prev, turnSeconds: null }));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    setSettings((prev) => ({ ...prev, turnSeconds: parsed <= 0 ? null : parsed }));
  };

  return (
    <main className="layout-grid lobby-grid" data-testid="lobby-screen">
      <section className="card stack-md">
        <h2 className="section-title">
          {t('lobby.title')} <span data-testid="lobby-room-code">{roomState.code}</span>
        </h2>
        <p className="meta-line">
          {t('lobby.modeLabel')}: {formatMode(roomState.mode)}
        </p>
        <p className="meta-line">
          {t('lobby.playersLabel')}: {roomState.playersPublic.length}
        </p>
        <p className="meta-line">
          {t('lobby.readyPlayersCount', { ready: readyForStartCount, total: totalPlayers })}
        </p>

        <ul className="player-list" data-testid="lobby-players-list">
          {roomState.playersPublic.map((player) => {
            const playerState = player.isLocalOnly
              ? t('lobby.localTag')
              : player.connected
                ? (player.ready ? t('lobby.ready') : t('lobby.notReady'))
                : t('lobby.reconnecting');
            return (
              <li
                key={player.id}
                className={!player.connected && !player.isLocalOnly ? 'player-list__item--reconnecting' : undefined}
                data-testid={`lobby-player-${player.id}`}
              >
                {player.name} {player.isHost ? `(${t('lobby.hostTag')})` : ''} {player.isLocalOnly ? `(${t('lobby.localTag')})` : ''}{' '}
                {playerState}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="button button-secondary button-block"
          onClick={() => onReady(!me?.ready)}
          data-testid="lobby-ready-toggle"
        >
          {me?.ready ? t('lobby.markNotReady') : t('lobby.markReady')}
        </button>

        <QRCode roomCode={roomState.code} />
      </section>

      {isHost && (
        <section className="card card--interactive stack-md" data-testid="host-settings">
          <h3 className="section-title section-title--sm">{t('lobby.hostSettingsTitle')}</h3>

          <div className="stack-sm">
            <fieldset className="field-group stack-sm">
              <legend className="meta-line">{t('lobby.localPlayersLegend')}</legend>
              <p className="meta-line">{t('lobby.localPlayersHelp')}</p>
              <div className="inline-row">
                <input
                  value={localPlayerName}
                  placeholder={t('lobby.playerNamePlaceholder')}
                  data-testid="host-local-player-name"
                  onChange={(event) => setLocalPlayerName(event.target.value)}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  data-testid="host-add-local-player"
                  disabled={!localPlayerName.trim()}
                  onClick={() => {
                    onAddLocalPlayer(localPlayerName.trim());
                    setLocalPlayerName('');
                  }}
                >
                  {t('lobby.addLocalPlayerAction')}
                </button>
              </div>
              {localPlayers.length > 0 && (
                <div className="stack-sm">
                  {localPlayers.map((player) => (
                    <div key={player.id} className="inline-row">
                      {editingPlayerId === player.id ? (
                        <>
                          <input
                            value={editingPlayerName}
                            placeholder={t('lobby.playerNamePlaceholder')}
                            data-testid={`host-edit-local-player-name-${player.id}`}
                            onChange={(event) => setEditingPlayerName(event.target.value)}
                          />
                          <button
                            type="button"
                            className="button button-secondary"
                            data-testid={`host-save-local-player-${player.id}`}
                            onClick={() => {
                              const nextName = editingPlayerName.trim();
                              if (nextName && nextName !== player.name) {
                                onRenameLocalPlayer(player.id, nextName);
                              }
                              setEditingPlayerId(null);
                            }}
                          >
                            {t('lobby.saveLocalPlayerAction')}
                          </button>
                          <button
                            type="button"
                            className="button button-ghost"
                            data-testid={`host-cancel-local-player-${player.id}`}
                            onClick={() => setEditingPlayerId(null)}
                          >
                            {t('lobby.cancelLocalPlayerAction')}
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="meta-line">
                            {`${player.name} (${player.ready ? t('lobby.ready') : t('lobby.notReady')})`}
                          </p>
                          <button
                            type="button"
                            className="button button-secondary"
                            data-testid={`host-edit-local-player-${player.id}`}
                            onClick={() => {
                              setEditingPlayerId(player.id);
                              setEditingPlayerName(player.name);
                            }}
                          >
                            {t('lobby.editLocalPlayerAction')}
                          </button>
                          <button
                            type="button"
                            className="button button-ghost"
                            data-testid={`host-remove-local-player-${player.id}`}
                            onClick={() => onRemoveLocalPlayer(player.id)}
                          >
                            {t('lobby.removeLocalPlayerAction')}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </fieldset>

            <label className="form-field">
              {t('lobby.civiliansLabel')}
              <input
                type="number"
                min={1}
                value={settings.roleCounts.civil}
                data-testid="host-role-civil"
                readOnly
              />
            </label>

            {roleRecommendations.length > 0 && (
              <fieldset className="field-group stack-sm" data-testid="host-role-recommendations">
                <legend className="meta-line">{t('lobby.recoLegend')}</legend>
                <p className="meta-line">{t('lobby.recoHint')}</p>
                <div className="stack-sm">
                  {roleRecommendations.map((recommendation) => (
                    <button
                      key={recommendation.id}
                      type="button"
                      className="button button-secondary button-block"
                      data-testid={`host-role-reco-${recommendation.id}`}
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          roleCounts: sanitizeRoleCounts(recommendation.roleCounts, totalPlayers)
                        }))
                      }
                    >
                      {t(`lobby.reco.${recommendation.id}.label` as Parameters<typeof t>[0])}{' '}
                      {t('lobby.recoSummary', {
                        civil: recommendation.roleCounts.civil,
                        undercover: recommendation.roleCounts.undercover,
                        mrWhite: recommendation.roleCounts.mrWhite
                      })}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <label className="form-field">
              {t('lobby.undercoverLabel')}
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                max={Math.max(0, totalPlayers - settings.roleCounts.mrWhite - 1)}
                value={settings.roleCounts.undercover}
                data-testid="host-role-undercover"
                onChange={(event) => updateUndercoverCount(event.target.value)}
              />
            </label>

            <label className="form-field">
              {t('lobby.mrWhiteLabel')}
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                max={Math.max(1, totalPlayers - 1)}
                value={settings.roleCounts.mrWhite}
                data-testid="host-role-mrwhite"
                onChange={(event) => updateMrWhiteCount(event.target.value)}
              />
            </label>

            <label className="form-field">
              {t('lobby.turnSecondsLabel')}
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={settings.turnSeconds ?? 0}
                data-testid="host-turn-seconds"
                onChange={(event) => updateTurnSeconds(event.target.value)}
              />
            </label>

            <fieldset className="field-group stack-sm">
              <legend className="meta-line">{t('lobby.randomCategoriesLegend')}</legend>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setSelectedCategories([...WORD_DECK_CATEGORIES])}
                  data-testid="host-random-select-all"
                >
                  {t('lobby.selectAllCategories')}
                </button>
              </div>
              <p className="meta-line">
                {allCategoriesSelected
                  ? t('lobby.allCategoriesSelected', { count: WORD_DECK_CATEGORIES.length })
                  : selectedCategoryCount === 0
                    ? t('lobby.noCategoriesSelected')
                    : t('lobby.categoriesSelectedCount', { count: selectedCategoryCount })}
              </p>
              <div className="stack-sm">
                {WORD_DECK_CATEGORIES.map((category) => (
                  <label key={category} className="choice-field">
                    <input
                      type="checkbox"
                      checked={selectedCategorySet.has(category)}
                      onChange={() => toggleCategory(category)}
                      data-testid={`host-random-category-${category.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                    {localizeCategory(category, getLocale())}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              data-testid="host-apply-config"
              onClick={() => onConfigure(settings, buildWordSource())}
            >
              {t('lobby.applyConfigAction')}
            </button>
            {!canStart && (
              <p className="meta-line" data-testid="host-start-warning">
                {t('lobby.roleCountMismatch', { configured: configuredRoleCount, ready: readyForStartCount })}
              </p>
            )}
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                onConfigure(settings, buildWordSource());
                onStart();
              }}
              data-testid="host-start-game"
              disabled={!canStart}
              title={
                canStart
                  ? t('lobby.startGameAction')
                  : t('lobby.startGameDisabled', { configured: configuredRoleCount, ready: readyForStartCount })
              }
            >
              {t('lobby.startGameAction')}
            </button>
            <button type="button" className="button button-ghost" onClick={onCloseRoom} data-testid="host-close-room">
              {t('lobby.backToHomeAction')}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
