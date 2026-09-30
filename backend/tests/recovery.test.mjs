/**
 * Account recovery, contact messages and search.
 * ---------------------------------------------------------------------------
 * Three things that did not exist, each of which fails silently in a way the
 * business only discovers from an angry customer:
 *
 *   • No password reset — a customer who forgot theirs was locked out for good,
 *     and the owner could not help either.
 *   • The contact form ran `setTimeout(600)` and showed "we'll be in touch".
 *     Every enquiry was discarded while the sender was told it had arrived.
 *   • The header search linked to a route that was never registered.
 */
import { suite, call, login, uniqueEmail, uniquePhone, OWNER_EMAIL } from './harness.mjs';

export default async function run() {
  const t = suite('recovery');
  const { check, section } = t;

  // --- Password reset ------------------------------------------------------
  section('Password reset');

  const email = uniqueEmail('resetme');
  const original = 'Original@123';

  await call('POST', '/auth/register', null, {
    fullName: 'Reset Target',
    email,
    phone: uniquePhone(),
    password: original,
  });

  const request = await call('POST', '/auth/forgot-password', null, { email });
  check('a reset request succeeds', request.status === 200, `status ${request.status}`);

  /*
   * The response must not reveal whether the account exists.
   *
   * "No account with that email" turns the form into a way of discovering who
   * banks here, one address at a time. Both outcomes return the same sentence.
   */
  const unknown = await call('POST', '/auth/forgot-password', null, {
    email: uniqueEmail('nobody'),
  });
  check(
    'an unknown address gets the SAME reply',
    unknown.status === 200 && unknown.body.message === request.body.message,
    `"${unknown.body.message}" vs "${request.body.message}"`,
  );

  // The token belongs in the email, never in an HTTP response — a browser
  // extension or a proxy log would otherwise capture a working reset link.
  check(
    'no token is leaked in the response',
    !JSON.stringify(request.body).toLowerCase().includes('token'),
    JSON.stringify(request.body),
  );

  const forged = await call('POST', '/auth/reset-password', null, {
    token: '0'.repeat(64),
    email,
    password: 'Forged@12345',
  });
  check('a forged token is refused', forged.status === 400, `status ${forged.status}`);

  const stillWorks = await call('POST', '/auth/login', null, { email, password: original });
  check('and the password is unchanged', stillWorks.status === 200, `status ${stillWorks.status}`);

  // --- Contact form --------------------------------------------------------
  section('Contact messages');

  const sent = await call('POST', '/messages', null, {
    name: 'Worried Customer',
    email: 'worried@example.test',
    phone: '03001234567',
    subject: 'Wrong order',
    message: 'I received the wrong item in my order, please can someone help.',
  });
  check('a message is accepted', sent.status === 201, `status ${sent.status}`);
  check(
    'a reference is returned to quote later',
    Boolean(sent.body.data?.reference),
    JSON.stringify(sent.body.data),
  );

  const rubbish = await call('POST', '/messages', null, { name: 'X', email: 'bad', message: 'hi' });
  check(
    'rubbish is refused with per-field errors',
    rubbish.status === 422 && rubbish.body.details?.length > 0,
    `status ${rubbish.status}`,
  );

  const ownerToken = await login(OWNER_EMAIL);
  const inbox = await call('GET', '/messages', ownerToken);
  check('the owner can read the inbox', inbox.status === 200, `status ${inbox.status}`);
  check(
    'the message is actually STORED, not just emailed',
    (inbox.body.data ?? []).some((m) => m.subject === 'Wrong order'),
    `${inbox.body.data?.length} messages`,
  );
  check(
    'an unread count is reported',
    typeof inbox.body.meta?.unread === 'number',
    JSON.stringify(inbox.body.meta),
  );

  const publicInbox = await call('GET', '/messages');
  check('the inbox is NOT public', publicInbox.status === 401, `status ${publicInbox.status}`);

  // --- Search --------------------------------------------------------------
  section('Menu search');

  const hits = await call('GET', '/catalog/products?search=chicken&limit=6');
  check(
    'search finds matching items',
    hits.status === 200 && hits.body.data.length > 0,
    `${hits.body.data?.length} results`,
  );

  const miss = await call('GET', '/catalog/products?search=zzzznotathing&limit=6');
  check(
    'no matches returns an empty list, not an error',
    miss.status === 200 && miss.body.data.length === 0,
    `status ${miss.status}`,
  );

  // An unescaped `.*` in a search box matches the entire catalogue.
  const injection = await call('GET', '/catalog/products?search=.*&limit=6');
  check(
    'a regex injection matches nothing',
    injection.body.data.length === 0,
    `${injection.body.data?.length} matched`,
  );

  return t.report();
}
