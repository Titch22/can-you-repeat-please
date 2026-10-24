import express, {
  Router,
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
} from 'express';
import type { z } from 'zod';
import {
  InviteCountSchema,
  LoginSchema,
  PasswordChangeSchema,
  SignupSchema,
  type AccountErrorCode,
  type AccountInfo,
} from '@cyrp/shared';
import { AccountError, SESSION_MS, type Accounts } from '../accounts/store.js';
import type { Limits } from '../limits.js';
import { soundsToken } from '../sounds/library.js';

const COOKIE = 'cyrp_session';

const STATUS: Record<AccountErrorCode, number> = {
  INVALID_PAYLOAD: 400,
  USERNAME_TAKEN: 409,
  BAD_CREDENTIALS: 401,
  INVALID_CODE: 403,
  NOT_LOGGED_IN: 401,
  NOT_ADMIN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
};

/** The session token in a Cookie header (Express doesn't parse cookies itself). */
export const sessionFromCookie = (header: string | undefined) =>
  header
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
const sessionToken = (req: Request) => sessionFromCookie(req.get('Cookie'));

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AccountError('INVALID_PAYLOAD');
  return result.data;
}

/**
 * Accounts: sign-up, login (an HttpOnly session cookie), password change, and the admin tools
 * (sign-up codes, password resets printed in the server console, never sent to the browser).
 */
export function accountRoutes(
  accounts: Accounts,
  limits: Limits,
  { secureCookies, soundsSecret }: { secureCookies: boolean; soundsSecret: string },
) {
  const router = Router();
  router.use(['/api/account', '/api/admin'], express.json({ limit: '10kb' }));

  /** Per address: slows down password guessing and sign-up spam. */
  const authLimit: RequestHandler = (req, _res, next) => {
    if (!limits.auth.take(req.ip ?? '')) throw new AccountError('RATE_LIMITED');
    next();
  };
  const requireUser: RequestHandler = (req, res, next) => {
    const user = accounts.userBySession(sessionToken(req));
    if (!user) throw new AccountError('NOT_LOGGED_IN');
    res.locals.user = user;
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) => {
    const user = accounts.userBySession(sessionToken(req));
    if (!user) throw new AccountError('NOT_LOGGED_IN');
    if (!accounts.isAdmin(user.username)) throw new AccountError('NOT_ADMIN');
    res.locals.user = user;
    next();
  };
  const startSession = (res: express.Response, token: string) =>
    // SameSite=Lax: no cookie on cross-site POSTs (and JSON bodies need a CORS preflight anyway).
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: SESSION_MS,
    });
  const info = (username: string | null): AccountInfo => ({
    user: username ? { username, isAdmin: accounts.isAdmin(username) } : null,
    signup: accounts.openSignup ? 'open' : 'code',
  });

  router.get('/api/account', (req, res) => {
    res.json(info(accounts.userBySession(sessionToken(req))?.username ?? null));
  });

  router.post('/api/account/signup', authLimit, async (req, res) => {
    const { username, password, code } = parse(SignupSchema, req.body);
    const account = await accounts.signup(username, password, code);
    startSession(res, account.token);
    console.log(`[accounts] ${req.ip} created account "${account.username}"`);
    res.json(info(account.username));
  });

  router.post('/api/account/login', authLimit, async (req, res) => {
    const { username, password } = parse(LoginSchema, req.body);
    const account = await accounts.login(username, password);
    startSession(res, account.token);
    res.json(info(account.username));
  });

  router.post('/api/account/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) accounts.logout(token);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // The browser's pass to the sounds service (its own sounds; the shared library for admins).
  router.get('/api/account/sounds-token', requireUser, (_req, res) => {
    const user = res.locals.user as { id: number; username: string };
    const ttlMs = 3600_000;
    res.json({
      token: soundsToken(soundsSecret, user.id, accounts.isAdmin(user.username), ttlMs),
      expiresAt: Date.now() + ttlMs,
    });
  });

  router.post('/api/account/password', authLimit, requireUser, async (req, res) => {
    const { oldPassword, newPassword } = parse(PasswordChangeSchema, req.body);
    const user = res.locals.user as { id: number };
    await accounts.changePassword(user.id, sessionToken(req)!, oldPassword, newPassword);
    res.json({ ok: true });
  });

  // ── Admin (ADMIN_USERNAMES) ────────────────────────────────────────────────────

  router.get('/api/admin/users', requireAdmin, (_req, res) => {
    res.json(accounts.listUsers());
  });

  router.post('/api/admin/users/:username/reset-password', requireAdmin, async (req, res) => {
    const { username, password } = await accounts.resetPassword(String(req.params.username));
    const admin = (res.locals.user as { username: string }).username;
    // Only in the server's console: the admin hands it over, the browser never sees it.
    console.log(`[accounts] password of "${username}" reset by ${admin}: ${password}`);
    res.json({ ok: true });
  });

  router.get('/api/admin/invites', requireAdmin, (_req, res) => {
    res.json(accounts.listInvites());
  });

  router.post('/api/admin/invites', requireAdmin, (req, res) => {
    const { count } = parse(InviteCountSchema, req.body);
    res.json({ codes: accounts.createInvites(count) });
  });

  router.delete('/api/admin/invites/:code', requireAdmin, (req, res) => {
    accounts.deleteInvite(String(req.params.code));
    res.json({ ok: true });
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof AccountError) {
      res.status(STATUS[err.code]).json({ ok: false, error: err.code });
    } else if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD' });
    } else {
      next(err);
    }
  };
  router.use(onError);

  return router;
}
