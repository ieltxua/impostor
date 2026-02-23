import { expect, test } from '@playwright/test';

test('host can add local player and it appears in lobby list', async ({ page, browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  await hostPage.goto('http://127.0.0.1:5174');
  await hostPage.getByTestId('home-create-name').fill('HostLocal');
  await hostPage.getByTestId('home-create-submit').click();

  await expect(hostPage.getByTestId('lobby-screen')).toBeVisible();
  await expect(hostPage.getByTestId('lobby-players-list')).toContainText('HostLocal');

  await hostPage.getByTestId('host-local-player-name').fill('Invitado');
  await hostPage.getByTestId('host-add-local-player').click();

  await expect(hostPage.getByTestId('lobby-players-list')).toContainText('Invitado');

  await hostContext.close();
});
