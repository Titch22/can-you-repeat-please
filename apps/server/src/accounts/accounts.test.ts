import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountError, createAccounts, hashPassword, verifyPassword } from './store.js';

const opened: { dir: string; close(): void }[] = [];
const open = (openSignup = false, now = Date.now) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-accounts-'));
  const accounts = createAccounts(path.join(dir, 'accounts.db'), {
    openSignup,
    admins: ['boss'],
    now,
  });
  opened.push({ dir, close: accounts.close });
  return accounts;
};
afterEach(() => {
  // Closed first: Windows can't delete a database file that is still open.
  for (const { dir, close } of opened.splice(0)) {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const failure = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e instanceof AccountError ? e.code : String(e);
  }
  return null;
};

describe('passwords', () => {
  it('stores a salted hash, never the password', async () => {
    const a = await hashPassword('hunter2hunter2');
    const b = await hashPassword('hunter2hunter2');
    expect(a).not.toContain('hunter2');
    expect(a).not.toBe(b); // random salt
    expect(await verifyPassword('hunter2hunter2', a)).toBe(true);
    expect(await verifyPassword('hunter2hunter3', a)).toBe(false);
  });
});

describe('accounts', () => {
  it('needs an unused code when sign-up is closed, and spends it', async () => {
    const accounts = open();
    expect(await failure(accounts.signup('alice', 'password1'))).toBe('INVALID_CODE');
    const [code] = accounts.createInvites(1);
    // Codes are typed by hand: case doesn't matter.
    const { token } = await accounts.signup('alice', 'password1', code!.toLowerCase());
    expect(accounts.userBySession(token)?.username).toBe('alice');
    expect(await failure(accounts.signup('bob', 'password1', code))).toBe('INVALID_CODE');
    expect(accounts.listInvites()).toMatchObject([{ code, usedBy: 'alice' }]);
  });

  it('lets anyone sign up when open, with unique usernames whatever their case', async () => {
    const accounts = open(true);
    await accounts.signup('Alice', 'password1');
    expect(await failure(accounts.signup('alice', 'password2'))).toBe('USERNAME_TAKEN');
    expect(accounts.listUsers()).toMatchObject([{ username: 'Alice', isAdmin: false }]);
  });

  it('logs in with the right password only, and logs out', async () => {
    const accounts = open(true);
    await accounts.signup('boss', 'password1');
    expect(await failure(accounts.login('boss', 'wrong-password'))).toBe('BAD_CREDENTIALS');
    expect(await failure(accounts.login('nobody', 'password1'))).toBe('BAD_CREDENTIALS');
    const { token } = await accounts.login('BOSS', 'password1');
    expect(accounts.isAdmin(accounts.userBySession(token)!.username)).toBe(true);
    accounts.logout(token);
    expect(accounts.userBySession(token)).toBeNull();
  });

  it('expires sessions', async () => {
    let now = 1_000;
    const accounts = open(true, () => now);
    const { token } = await accounts.signup('alice', 'password1');
    now += 31 * 24 * 3600_000;
    expect(accounts.userBySession(token)).toBeNull();
  });

  it('changes a password with the old one, logging out the other sessions', async () => {
    const accounts = open(true);
    const { token: here } = await accounts.signup('alice', 'password1');
    const { token: elsewhere } = await accounts.login('alice', 'password1');
    const id = accounts.userBySession(here)!.id;
    expect(await failure(accounts.changePassword(id, here, 'wrong', 'password2'))).toBe(
      'BAD_CREDENTIALS',
    );
    await accounts.changePassword(id, here, 'password1', 'password2');
    expect(accounts.userBySession(here)).not.toBeNull();
    expect(accounts.userBySession(elsewhere)).toBeNull();
    expect(await failure(accounts.login('alice', 'password1'))).toBe('BAD_CREDENTIALS');
    await accounts.login('alice', 'password2');
  });

  it('resets a password to a new random one, logging the user out everywhere', async () => {
    const accounts = open(true);
    const { token } = await accounts.signup('alice', 'password1');
    const { password } = await accounts.resetPassword('ALICE');
    expect(password).toHaveLength(12);
    expect(accounts.userBySession(token)).toBeNull();
    await accounts.login('alice', password);
    expect(await failure(accounts.resetPassword('nobody'))).toBe('NOT_FOUND');
  });

  it('gives a code for the first account only while there is none', async () => {
    expect(open(true).firstAccountCode()).toBeNull(); // open: no code needed
    const accounts = open();
    const code = accounts.firstAccountCode();
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    expect(accounts.firstAccountCode()).toBe(code); // the same until used
    await accounts.signup('boss', 'password1', code!);
    expect(accounts.firstAccountCode()).toBeNull();
  });

  it('deletes codes', async () => {
    const accounts = open();
    const [code] = accounts.createInvites(2);
    accounts.deleteInvite(code!);
    expect(accounts.listInvites()).toHaveLength(1);
    expect(await failure(() => accounts.deleteInvite(code!))).toBe('NOT_FOUND');
  });
});
