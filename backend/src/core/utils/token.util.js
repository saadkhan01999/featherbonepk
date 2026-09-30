/**
 * Token minting and verification.
 * ---------------------------------------------------------------------------
 * Three separate token families, each signed with its own secret:
 *
 *   access   — short-lived, sent as `Authorization: Bearer`, held in memory
 *   refresh  — long-lived, httpOnly cookie, rotated on every use
 *   pos      — the till's session, issued by the POS login only
 *
 * Why the POS gets its own secret: a terminal is a shared physical device left
 * logged in on a shop counter. Signing it with the website's secret would make
 * a stolen till token interchangeable with a customer session, and would mean
 * rotating one secret logs out the other. Separate secrets keep the blast
 * radius of a compromised terminal inside the shop.
 *
 * A token verified with the wrong secret fails signature validation, so a POS
 * token can never be replayed against a customer endpoint even if the audience
 * claim were tampered with.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env.config.js';

/** Audience claims — a second, explicit guard beyond the differing secrets. */
export const TOKEN_AUDIENCE = Object.freeze({
  ACCESS: 'fb:web',
  REFRESH: 'fb:refresh',
  POS: 'fb:pos',
});

const ISSUER = 'feather-and-bone';

/**
 * Access token for the website and back office.
 * Kept deliberately small — it travels on every request.
 */
export function signAccessToken({ userId, role, sessionId }) {
  return jwt.sign({ sub: String(userId), role, sid: sessionId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: ISSUER,
    audience: TOKEN_AUDIENCE.ACCESS,
  });
}

/** Long-lived refresh token. Stored hashed server-side (see hashToken). */
export function signRefreshToken({ userId, sessionId }) {
  return jwt.sign({ sub: String(userId), sid: sessionId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: ISSUER,
    audience: TOKEN_AUDIENCE.REFRESH,
  });
}

/**
 * POS terminal session.
 * Carries the terminal id as well as the cashier: every sale must be
 * attributable to both a person and a physical till for the drawer to
 * reconcile at end of shift.
 */
export function signPosToken({ userId, role, terminalId, storeId = null, shiftId = null }) {
  return jwt.sign(
    {
      sub: String(userId),
      role,
      terminal: terminalId,
      // The counter this till stands at. Carried in the token so the cashier
      // has no parameter with which to ask for another store's menu.
      store: storeId ? String(storeId) : null,
      shift: shiftId ? String(shiftId) : null,
    },
    env.JWT_POS_SECRET,
    {
      expiresIn: env.JWT_POS_EXPIRES_IN,
      issuer: ISSUER,
      audience: TOKEN_AUDIENCE.POS,
    },
  );
}

/** Verify helpers. Each throws on signature/expiry failure — the error handler
 *  translates jwt errors into clean 401s. */
export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: TOKEN_AUDIENCE.ACCESS });

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER, audience: TOKEN_AUDIENCE.REFRESH });

export const verifyPosToken = (token) =>
  jwt.verify(token, env.JWT_POS_SECRET, { issuer: ISSUER, audience: TOKEN_AUDIENCE.POS });

/**
 * Hash a token for storage.
 *
 * Refresh tokens are stored hashed, never in plaintext: a leaked database dump
 * would otherwise hand an attacker every live session. SHA-256 (not bcrypt) is
 * correct here — the input is already 256 bits of unguessable entropy, so slow
 * hashing buys nothing and would add latency to every refresh.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * A stable session id derived from the token hash.
 * Lets a request identify "this device" without widening cookie scope, so
 * "sign out this session" works on any route.
 */
/*
 * Removed: `sessionIdOf(tokenHash)`.
 *
 * It derived a session id from the hash of a refresh token. Because a JWT is a
 * pure function of its claims and `iat` has one-second resolution, two logins
 * by the same user in the same second produced identical tokens and therefore
 * identical session ids — which silently broke "sign out other devices".
 *
 * Session ids are now `randomToken(16)`, generated once at issue time. Do not
 * reintroduce a derived id.
 */

/** Cryptographically random token for email verification / password reset. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
