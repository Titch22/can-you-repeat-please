import { expect, test } from './fixtures';

test('links leading out of the room warn first, and leave it on OK', async ({ newPlayer }) => {
  const page = await newPlayer();
  await page.goto('/');
  await page.getByLabel('Nickname').fill('Leaver');
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  const room = new URL(page.url()).pathname;

  // Play (the room itself) and the footer's GitHub link (a new tab) don't ask.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    // The first warning is cancelled, the next one accepted.
    void (dialogs.length === 1 ? d.dismiss() : d.accept());
  });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Play' }).click();
  await expect(page).toHaveURL(room);
  expect(dialogs).toEqual([]);

  // A link in the lobby: cancelled, the player stays; accepted, they leave the room.
  const login = page.getByRole('link', { name: 'Log in to add sounds from a link' });
  await login.click();
  await expect(page).toHaveURL(room);
  await expect(page.getByTestId('room-code')).toBeVisible();
  await login.click();
  await expect(page).toHaveURL('/login');
  expect(dialogs).toEqual([
    'You will leave the current game if you proceed.',
    'You will leave the current game if you proceed.',
  ]);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Play' }).click();
  await expect(page).toHaveURL('/'); // not in a room anymore
  await expect(page.getByText('You’re in room')).toHaveCount(0);
});
