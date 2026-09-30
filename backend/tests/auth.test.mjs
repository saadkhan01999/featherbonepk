/**
 * Authentication, sessions and account security.
 */
import { API, call, login, suite, PW, OWNER_EMAIL, uniqueEmail, uniquePhone, decode } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('auth');

  section('Credentials');
  const email = uniqueEmail('auth');
  const registered = await call('POST', '/auth/register', null, {
    fullName: 'Auth Tester',
    email,
    phone: uniquePhone('0331'),
    password: PW,
  });
  check('registration succeeds', registered.status === 201, `got ${registered.status}`);
  check('tokens issued on registration', Boolean(registered.body.data?.accessToken));
  check('password never echoed back', !JSON.stringify(registered.body).includes('"password"'));

  const dupe = await call('POST', '/auth/register', null, {
    fullName: 'Duplicate',
    email,
    phone: uniquePhone('0332'),
    password: PW,
  });
  check('duplicate email refused', dupe.status === 409, `got ${dupe.status}`);

  const weak = await call('POST', '/auth/register', null, {
    fullName: 'Weak Pass',
    email: uniqueEmail('weak'),
    phone: uniquePhone('0333'),
    password: 'abc',
  });
  check('weak password refused', weak.status === 422 || weak.status === 400, `got ${weak.status}`);

  section('Account enumeration defence');
  const unknownUser = await call('POST', '/auth/login', null, {
    email: 'nobody-here@fb.test',
    password: PW,
  });
  const wrongPassword = await call('POST', '/auth/login', null, {
    email,
    password: 'NotThePassword!1',
  });
  check(
    'unknown email and wrong password are INDISTINGUISHABLE',
    unknownUser.status === wrongPassword.status && unknownUser.body.message === wrongPassword.body.message,
    'otherwise the login form tells an attacker which emails are registered',
  );

  section('Roles are never client-supplied');
  const escalation = await call('POST', '/auth/register', null, {
    fullName: 'Would Be Admin',
    email: uniqueEmail('esc'),
    phone: uniquePhone('0334'),
    password: PW,
    role: 'super_admin',
  });
  const escalatedRole = escalation.body.data?.user?.role;
  check('self-signup cannot mint a super admin', escalatedRole === 'customer', String(escalatedRole));

  section('Session identity');
  const first = await login(email);
  const second = await login(email);
  check(
    'two sign-ins produce DISTINCT session ids',
    decode(first).sid !== decode(second).sid,
    'colliding ids silently break "sign out other devices"',
  );

  const burst = [];
  for (let i = 0; i < 5; i += 1) burst.push(decode(await login(email)).sid);
  check(
    'five rapid sign-ins are all distinct',
    new Set(burst).size === 5,
    `${new Set(burst).size} unique of 5`,
  );

  section('Token audiences do not cross');
  const webToken = await login('cashier@featherandbone.dev');
  check(
    'a website token is rejected by the till API',
    (await call('GET', '/pos/summary', webToken)).status === 401,
    'the POS uses a different signing secret',
  );

  const pos = await call('POST', '/auth/pos/login', null, {
    email: 'cashier@featherandbone.dev',
    password: PW,
    terminalId: 'TILL-01',
  });
  check(
    'a POS token is rejected by back-office routes',
    (await call('GET', '/staff', pos.body.data?.posToken)).status === 401,
  );

  section('Protected routes');
  check('anonymous cannot read an account', (await call('GET', '/account', null)).status === 401);
  const garbage = await call('GET', '/account', 'not.a.real.token');
  check('a malformed token is rejected', garbage.status === 401, `got ${garbage.status}`);

  // --- Brute-force lockout -------------------------------------------------
  section('Lockout after repeated failures');

  /*
   * A throwaway account, deliberately.
   *
   * Locking a shared fixture would strand every later suite behind a real
   * one-minute wait — and the failure would look like a permissions bug rather
   * than a test locking itself out.
   */
  const victimEmail = uniqueEmail('lockme');
  await call('POST', '/auth/register', null, {
    fullName: 'Lock Target',
    email: victimEmail,
    phone: uniquePhone(),
    password: PW,
  });

  const attempts = [];
  for (let i = 0; i < 5; i += 1) {
    // Sequential on purpose: these attempts must arrive in order for the
    // lockout counter to mean anything.
    const result = await call('POST', '/auth/login', null, {
      email: victimEmail,
      password: 'DefinitelyWrong@9',
    });
    attempts.push(result.status);
  }

  check(
    'the first four wrong passwords are plain 401s',
    attempts.slice(0, 4).every((s) => s === 401),
    attempts.join(', '),
  );
  check('the fifth is refused as locked', attempts[4] === 403, attempts.join(', '));

  const locked = await call('POST', '/auth/login', null, { email: victimEmail, password: PW });
  check(
    'even the CORRECT password is refused while locked',
    locked.status === 403,
    `status ${locked.status}`,
  );
  /*
   * The wait must read like English. It used to say "1 minute(s)" — and with a
   * fifteen-minute lock, a cashier with a queue simply gave up.
   *
   * Either "45 seconds" or "1 minute" is fine; the test accepts both because
   * which one appears depends on the millisecond the check runs. What must not
   * appear is the "(s)" pluralisation.
   */
  check(
    'the wait reads naturally, with no "(s)"',
    /\d+ (seconds?|minutes?)\./.test(locked.body.message ?? '') && !locked.body.message.includes('(s)'),
    locked.body.message,
  );

  check(
    'the lock is short — one minute, not fifteen',
    /1 minute\.|\d\d? seconds?\./.test(locked.body.message ?? ''),
    locked.body.message,
  );

  // --- Password policy -----------------------------------------------------
  section('Password policy');

  /*
   * Three of four character classes, not all four.
   *
   * Requiring all four produces `Password1!` — people satisfy a checklist the
   * most predictable way available. It also made the seeded owner password
   * impossible to re-enter through the UI, so the account had a password the
   * application itself would reject.
   */
  const policyCases = [
    ['superadmin@123', 201, 'lower + digit + symbol'],
    ['Str0ng!Pass', 201, 'all four classes'],
    ['alllowercase', 422, 'one class only'],
    ['Ab1!', 422, 'too short'],
  ];

  for (const [password, expected, why] of policyCases) {
    // Sequential on purpose: it keeps the PASS/FAIL lines in the same order
    // as the cases they came from.
    const result = await call('POST', '/auth/register', null, {
      fullName: 'Policy Probe',
      email: uniqueEmail('policy'),
      phone: uniquePhone(),
      password,
    });
    check(`"${password}" -> ${expected} (${why})`, result.status === expected, `got ${result.status}`);
  }

  section('Three doors: each turns away the wrong audience');
  /*
   * The storefront and the back office now have separate sign-in pages, so a
   * customer never lands on a staff form and a manager never has to hunt for
   * the dashboard. `scope` says which door was used.
   *
   * This is a clarity control, not a security boundary — anyone talking to the
   * API directly can omit `scope`, which is why the no-scope case below must
   * keep working. The real boundary is checkPermission on every route.
   */
  const staffDoor = await call('POST', '/auth/login', null, {
    email: OWNER_EMAIL,
    password: PW,
    scope: 'staff',
  });
  check('staff sign in at the staff portal', staffDoor.status === 200);

  const staffAtShop = await call('POST', '/auth/login', null, {
    email: OWNER_EMAIL,
    password: PW,
    scope: 'customer',
  });
  check('staff are refused at the customer login', staffAtShop.status === 403, String(staffAtShop.status));
  check(
    'and told where to go instead',
    /staff portal/i.test(staffAtShop.body.message ?? ''),
    staffAtShop.body.message,
  );

  const noScope = await call('POST', '/auth/login', null, { email: OWNER_EMAIL, password: PW });
  check(
    'omitting scope still works',
    noScope.status === 200,
    'direct API clients and this suite must not be broken by a UI concern',
  );

  section('"Remember me" actually controls the session length');
  /*
   * `refreshCookieOptions` took `{ maxAge = SEVEN_DAYS }` and the caller passed
   * `rememberMe ? SEVEN_DAYS : undefined` — and a destructuring default fires on
   * `undefined`, so declining "remember me" handed over the exact value that
   * re-triggered the seven-day default. Every login was a week-long session on
   * whatever machine it happened on, silently.
   */
  const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).find((c) => c.includes('fb_refresh')) ?? '';
  const maxAgeOf = (cookie) => /Max-Age=(\d+)/i.exec(cookie)?.[1] ?? null;

  // Raw fetch: this assertion is about a response header, which the shared
  // `call()` helper deliberately does not surface.
  const signIn = (rememberMe) =>
    fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, password: PW, rememberMe }),
    });

  const remembered = await signIn(true);
  const forgotten = await signIn(false);

  check(
    'remembered sessions get a lasting cookie',
    Number(maxAgeOf(cookieOf(remembered))) > 0,
    String(maxAgeOf(cookieOf(remembered))),
  );
  check(
    'declined sessions get a SESSION cookie',
    maxAgeOf(cookieOf(forgotten)) === null,
    `Max-Age=${maxAgeOf(cookieOf(forgotten))} — the box was unticked`,
  );

  // And a rotation must not quietly upgrade it: the browser sends a cookie's
  // value back, never its Max-Age, so the choice has to be stored server-side.
  const jar = cookieOf(forgotten).split(';')[0];
  const rotated = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { Cookie: jar } });
  check(
    'and a refresh keeps it a session cookie',
    maxAgeOf(cookieOf(rotated)) === null,
    `Max-Age=${maxAgeOf(cookieOf(rotated))} after rotation`,
  );

  return report();
}
