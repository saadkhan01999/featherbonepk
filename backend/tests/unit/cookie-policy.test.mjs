/**
 * Refresh-cookie SameSite policy.
 *   node --env-file=.env tests/unit/cookie-policy.test.mjs
 *
 * Guards a bug that cost a deployment and produced no error message anywhere.
 * With the site on featherbonepk.com and the API on railway.app, a Strict cookie
 * is never sent cross-site: login succeeded, the cookie was stored, and every
 * subsequent /auth/refresh arrived without it — so the user was signed out again
 * by the next page load. Nothing logged, nothing 500'd, nothing to search for.
 *
 * Needs no database or server, which is why it lives outside tests/run.mjs.
 */
import assert from 'node:assert/strict';
const { refreshCookieOptions, clearRefreshCookie } = await import('../../src/config/cookie.config.js');
const fake = (hostname) => ({ hostname });
let n = 0;
const show = (label, o) => {
  console.log(`  ${label.padEnd(46)} sameSite=${o.sameSite}  secure=${o.secure}`);
  n++;
};

const cross = refreshCookieOptions(fake('featherbonepk-production.up.railway.app'), { persistent: true });
show('cross-site (railway.app vs featherbonepk.com)', cross);
assert.equal(cross.sameSite, 'none', 'cross-site must be None or the cookie is never sent');
assert.equal(cross.secure, true, 'SameSite=None is rejected by browsers without Secure');

const same = refreshCookieOptions(fake('backend.featherbonepk.com'), { persistent: true });
show('same-site (backend.featherbonepk.com)', same);
assert.equal(same.sameSite, 'strict', 'same-site should keep the stricter policy');

const apex = refreshCookieOptions(fake('featherbonepk.com'), {});
show('same-site (apex)', apex);
assert.equal(apex.sameSite, 'strict');

const noReq = refreshCookieOptions(undefined, {});
show('no request available (fail safe)', noReq);
assert.equal(noReq.sameSite, 'strict', 'absent request must not relax the policy');

// clearRefreshCookie must mirror the flags, or logout silently leaves the cookie.
let cleared;
clearRefreshCookie(
  {
    clearCookie: (_n, o) => {
      cleared = o;
    },
  },
  fake('featherbonepk-production.up.railway.app'),
);
show('logout mirrors the set flags', cleared);
assert.equal(cleared.sameSite, cross.sameSite);
assert.equal(cleared.path, cross.path);

console.log(`\n${n}/${n} cookie policy checks passed.`);
