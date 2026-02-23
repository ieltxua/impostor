import { expect, test } from '@playwright/test';

test('remote player can reveal own secret in mixed lobby (remote + local no-device)', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  await hostPage.goto(baseURL ?? 'http://127.0.0.1:5174');
  await hostPage.getByTestId('home-create-name').fill(`Host-${Date.now()}`);
  await hostPage.getByTestId('home-create-submit').click();
  await expect(hostPage.getByTestId('lobby-screen')).toBeVisible();

  const roomCode = (await hostPage.getByTestId('lobby-room-code').innerText()).trim();

  const remoteContext = await browser.newContext();
  const remotePage = await remoteContext.newPage();
  await remotePage.goto(`${baseURL ?? 'http://127.0.0.1:5174'}/join/${roomCode}`);
  await remotePage.getByTestId('home-join-name').fill(`Remote-${Date.now()}`);
  await remotePage.getByTestId('home-join-submit').click();
  await expect(remotePage.getByTestId('lobby-screen')).toBeVisible();

  await hostPage.getByTestId('host-local-player-name').fill('Local Uno');
  await hostPage.getByTestId('host-add-local-player').click();
  await expect(hostPage.getByTestId('lobby-players-list')).toContainText('Local Uno');

  await remotePage.getByTestId('lobby-ready-toggle').click();

  await hostPage.getByTestId('host-role-undercover').fill('0');
  await hostPage.getByTestId('host-role-mrwhite').fill('1');
  await hostPage.getByTestId('host-turn-seconds').fill('0');
  await hostPage.getByTestId('host-apply-config').click();
  await hostPage.getByTestId('host-start-game').click();

  await expect(remotePage.getByTestId('game-status')).toContainText(/REVEAL|Revelación/);
  await expect(hostPage.getByTestId('game-status')).toContainText(/REVEAL|Revelación/);
  await expect(hostPage.getByTestId('live-reveal-panel')).toBeVisible();
  await expect(remotePage.getByTestId('secret-reveal-button')).toBeVisible();
  await expect(remotePage.locator('text=Esperando asignación de rol')).toHaveCount(0);

  await remoteContext.close();
  await hostContext.close();
});
