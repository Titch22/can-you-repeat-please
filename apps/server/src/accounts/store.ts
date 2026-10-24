import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import type { AccountErrorCode } from '@cyrp/shared';

export class AccountError extends Error {
  constructor(public readonly code: AccountErrorCode) {
    super(code);
  }
}

/** How long a login lasts. */
export const SESSION_MS = 30 * 24 * 3600_000;
const KEY_BYTES = 32;
// No 0/O, 1/I/L: codes are read and typed by people.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const b64 = (b: Buffer) => b.toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

/** "scrypt$<salt>$<key>": scrypt (Node's defaults: N=16384, r=8, p=1) with a random salt. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${b64(salt)}$${b64(await scryptAsync(password, salt, KEY_BYTES))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

/**
 * Player accounts, in SQLite: users (scrypt password hashes), login sessions (only a hash of
 * each token is stored) and single-use sign-up codes.
 */
export function createAccounts(
  dbFile: string,
  opts: { openSignup: boolean; admins: string[]; now?: () => number },
) {
  const now = opts.now ?? Date.now;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      used_by INTEGER REFERENCES users(id),
      used_at INTEGER
    );
  `);
  const dropExpired = () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  dropExpired();

  const isAdmin = (username: string) => opts.admins.includes(username.toLowerCase());
  const userNamed = (username: string) =>
    db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as
      UserRow | undefined;
  const userById = (id: number) =>
    db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(id) as
      UserRow | undefined;

  /** A new login for `userId`: the token for the cookie (only its hash is kept). */
  const newSession = (userId: number) => {
    const token = b64(randomBytes(32));
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token),
      userId,
      now() + SESSION_MS,
    );
    return token;
  };

  const newCode = () =>
    Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
      '',
    );

  const createInvites = (count: number) => {
    const insert = db.prepare('INSERT INTO invites (code, created_at) VALUES (?, ?)');
    return Array.from({ length: count }, () => {
      const code = newCode();
      insert.run(code, now());
      return code;
    });
  };

  // Compared against when the username doesn't exist, so a login takes as long either way.
  let dummyHash: Promise<string> | null = null;

  return {
    openSignup: opts.openSignup,
    isAdmin,

    /**
     * Creates an account and logs it in. Needs an unused code unless sign-up is open, and always
     * for a name in ADMIN_USERNAMES (or anyone could take an admin name not created yet).
     */
    async signup(username: string, password: string, code?: string) {
      const hash = await hashPassword(password);
      db.exec('BEGIN');
      try {
        // Checked after hashing (which waits): two sign-ups can't both spend one code.
        const needsCode = !opts.openSignup || isAdmin(username);
        const invite = !needsCode
          ? null
          : (db
              .prepare('SELECT code FROM invites WHERE code = ? AND used_by IS NULL')
              .get((code ?? '').toUpperCase()) as { code: string } | undefined);
        if (needsCode && !invite) throw new AccountError('INVALID_CODE');
        if (userNamed(username)) throw new AccountError('USERNAME_TAKEN');
        const { lastInsertRowid } = db
          .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
          .run(username, hash, now());
        const id = Number(lastInsertRowid);
        if (invite) {
          db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(
            id,
            now(),
            invite.code,
          );
        }
        db.exec('COMMIT');
        return { username, token: newSession(id) };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async login(username: string, password: string) {
      dropExpired();
      const user = userNamed(username);
      dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
      const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
      if (!user || !ok) throw new AccountError('BAD_CREDENTIALS');
      return { username: user.username, token: newSession(user.id) };
    },

    /** The user logged in with `token`, if the session exists and hasn't expired. */
    userBySession(token: string | undefined) {
      if (!token) return null;
      const row = db
        .prepare(
          `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(sha256(token), now()) as { id: number; username: string } | undefined;
      return row ?? null;
    },

    logout(token: string) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    },

    /** Needs the current password. Logs out the user's other sessions. */
    async changePassword(userId: number, token: string, oldPassword: string, newPassword: string) {
      const user = userById(userId);
      if (!user || !(await verifyPassword(oldPassword, user.password_hash))) {
        throw new AccountError('BAD_CREDENTIALS');
      }
      const hash = await hashPassword(newPassword);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(
        userId,
        sha256(token),
      );
    },

    /** Gives the user a new random password (returned) and logs out all their sessions. */
    async resetPassword(username: string) {
      const user = userNamed(username);
      if (!user) throw new AccountError('NOT_FOUND');
      const password = b64(randomBytes(9)); // 12 characters
      const hash = await hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      return { username: user.username, password };
    },

    listUsers() {
      const rows = db
        .prepare('SELECT username, created_at FROM users ORDER BY username COLLATE NOCASE')
        .all() as { username: string; created_at: number }[];
      return rows.map((r) => ({
        username: r.username,
        createdAt: r.created_at,
        isAdmin: isAdmin(r.username),
      }));
    },

    createInvites,

    listInvites() {
      const rows = db
        .prepare(
          `SELECT i.code, i.created_at, i.used_at, u.username AS used_by FROM invites i
           LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC, i.code`,
        )
        .all() as {
        code: string;
        created_at: number;
        used_at: number | null;
        used_by: string | null;
      }[];
      return rows.map((r) => ({
        code: r.code,
        createdAt: r.created_at,
        usedBy: r.used_by,
        usedAt: r.used_at,
      }));
    },

    deleteInvite(code: string) {
      const { changes } = db.prepare('DELETE FROM invites WHERE code = ?').run(code);
      if (!changes) throw new AccountError('NOT_FOUND');
    },

    /**
     * With no account yet and sign-up closed, nobody could ever get a code: a code for the first
     * account (the same one until it's used). Null otherwise.
     */
    firstAccountCode() {
      if (opts.openSignup) return null;
      const users = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
      if (users > 0) return null;
      const unused = db.prepare('SELECT code FROM invites WHERE used_by IS NULL LIMIT 1').get() as
        { code: string } | undefined;
      return unused?.code ?? createInvites(1)[0]!;
    },

    close() {
      db.close();
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
