import { expect, test } from '@playwright/test';

test('host sees joined players and local players in lobby', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  await hostPage.goto(baseURL ?? 'http://127.0.0.1:5174');
  await hostPage.getByTestId('home-create-name').fill('HostLocal');
  await hostPage.getByTestId('home-create-submit').click();

  const roomCode = (await hostPage.getByTestId('lobby-room-code').innerText()).trim();

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.addInitScript((code) => {
    window.localStorage.setItem('impostor.session', JSON.stringify({
      roomCode: 'ZZZZZ',
      playerName: `Stale-${Date.now()}`,
      playerToken: `stale-${Date.now()}`
    }));
  }, roomCode);
  await playerPage.goto(`${baseURL ?? 'http://127.0.0.1:5174'}/?room=${roomCode}`);
  await playerPage.getByTestId('home-join-name').fill('Invitado');
  await playerPage.getByTestId('home-join-submit').click();

  await expect(hostPage.getByTestId('lobby-players-list')).toContainText('Invitado');
  await expect(hostPage.getByTestId('lobby-players-list')).toContainText('HostLocal');

  await hostPage.getByTestId('host-local-player-name').fill('Local2');
  await hostPage.getByTestId('host-add-local-player').click();
  await expect(hostPage.getByTestId('lobby-players-list')).toContainText('Local2');

  await hostContext.close();
  await playerContext.close();
});
