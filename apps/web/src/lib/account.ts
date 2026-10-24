import { create } from 'zustand';
import type { AccountErrorCode, AccountInfo } from '@cyrp/shared';
import { loadProfile, saveProfile } from './storage';

/** Who is logged in (null: nobody), and whether sign-up needs a code. Loaded at startup. */
export const useAccount = create<AccountInfo & { loaded: boolean }>(() => ({
  user: null,
  signup: 'code',
  loaded: false,
}));

export type AccountResult<T> =
  { ok: true; value: T } | { ok: false; error: AccountErrorCode | 'NETWORK' };

/** Same origin: the session cookie (HttpOnly, set by the server) goes along by itself. */
async function call<T>(method: string, path: string, body?: unknown): Promise<AccountResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: AccountErrorCode };
    if (res.ok) return { ok: true, value: data as T };
    return { ok: false, error: data.error ?? 'NETWORK' };
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
}

export async function refreshAccount() {
  const result = await call<AccountInfo>('GET', '/api/account');
  if (result.ok) useAccount.setState({ ...result.value, loaded: true });
  else useAccount.setState({ loaded: true });
}

/** Logged in: the account's name becomes the nickname (still editable on the home page). */
function loggedIn(result: AccountResult<AccountInfo>) {
  if (!result.ok) return result;
  useAccount.setState({ ...result.value, loaded: true });
  if (result.value.user) saveProfile({ ...loadProfile(), nickname: result.value.user.username });
  return result;
}

export const signup = async (username: string, password: string, code?: string) =>
  loggedIn(await call<AccountInfo>('POST', '/api/account/signup', { username, password, code }));

export const login = async (username: string, password: string) =>
  loggedIn(await call<AccountInfo>('POST', '/api/account/login', { username, password }));

export async function logout() {
  await call('POST', '/api/account/logout');
  useAccount.setState({ user: null });
}

export const changePassword = (oldPassword: string, newPassword: string) =>
  call<{ ok: true }>('POST', '/api/account/password', { oldPassword, newPassword });

// ── Admin (ADMIN_USERNAMES) ──────────────────────────────────────────────────────

export interface AccountUser {
  username: string;
  createdAt: number;
  isAdmin: boolean;
}
export interface Invite {
  code: string;
  createdAt: number;
  usedBy: string | null;
  usedAt: number | null;
}

export const listUsers = () => call<AccountUser[]>('GET', '/api/admin/users');
export const listInvites = () => call<Invite[]>('GET', '/api/admin/invites');
export const createInvites = (count: number) =>
  call<{ codes: string[] }>('POST', '/api/admin/invites', { count });
export const deleteInvite = (code: string) =>
  call<{ ok: true }>('DELETE', `/api/admin/invites/${encodeURIComponent(code)}`);
/** The new password is printed in the server's console, not returned. */
export const resetPassword = (username: string) =>
  call<{ ok: true }>('POST', `/api/admin/users/${encodeURIComponent(username)}/reset-password`);

export const ACCOUNT_ERROR_TEXT: Record<AccountErrorCode | 'NETWORK', string> = {
  INVALID_PAYLOAD:
    'Check the fields: usernames are 3–20 letters, digits, “_”, “.” or “-”; passwords 8+ characters.',
  USERNAME_TAKEN: 'That username is taken.',
  BAD_CREDENTIALS: 'Wrong username or password.',
  INVALID_CODE: 'That code is wrong or was already used.',
  NOT_LOGGED_IN: 'You’re not logged in (anymore).',
  NOT_ADMIN: 'Only administrators can do that.',
  NOT_FOUND: 'Not found.',
  RATE_LIMITED: 'Too many attempts: wait a minute and try again.',
  NETWORK: 'The server is unreachable.',
};
