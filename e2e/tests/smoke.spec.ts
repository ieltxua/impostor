import { expect, test } from '@playwright/test';

test('host and player can complete a minimal end-to-end match flow', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  const hostName = `Host-${Date.now()}`;
  await hostPage.goto(baseURL ?? '/');
  await hostPage.getByTestId('home-create-name').fill(hostName);
  await hostPage.getByTestId('home-create-submit').click();

  await expect(hostPage.getByTestId('lobby-screen')).toBeVisible();
  const roomCode = (await hostPage.getByTestId('lobby-room-code').innerText()).trim();
  expect(roomCode).toHaveLength(5);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  const playerName = `Player-${Date.now()}`;

  await playerPage.goto(`${baseURL ?? ''}/?room=${roomCode}`);
  await playerPage.getByTestId('home-join-name').fill(playerName);
  await playerPage.getByTestId('home-join-submit').click();

  await expect(playerPage.getByTestId('lobby-screen')).toBeVisible();
  await expect(hostPage.getByTestId('lobby-players-list')).toContainText(playerName);

  await playerPage.getByTestId('lobby-ready-toggle').click();

  await hostPage.getByTestId('host-role-civil').fill('1');
  await hostPage.getByTestId('host-role-undercover').fill('0');
  await hostPage.getByTestId('host-role-mrwhite').fill('1');
  await hostPage.getByTestId('host-turn-seconds').fill('1');
  await hostPage.getByTestId('host-apply-config').click();
  await hostPage.getByTestId('host-start-game').click();

  await expect(hostPage.getByTestId('game-status')).toContainText('REVEAL');
  await expect(playerPage.getByTestId('game-status')).toContainText('REVEAL');

  await hostPage.getByTestId('host-close-reveal').click();
  await expect(hostPage.getByTestId('game-status')).toContainText('CLUES');
  await expect(hostPage.getByTestId('game-status')).toContainText('VOTE', { timeout: 20_000 });
  await expect(playerPage.getByTestId('game-status')).toContainText('VOTE', { timeout: 20_000 });

  await hostPage.locator('[data-testid^="vote-target-"]:not([disabled])').first().click();
  await playerPage.locator('[data-testid^="vote-target-"]:not([disabled])').first().click();

  await expect(hostPage.getByTestId('game-status')).toContainText('END');
  await expect(playerPage.getByTestId('game-status')).toContainText('END');
  await expect(hostPage.getByText('Game End')).toBeVisible();

  await playerContext.close();
  await hostContext.close();
});
