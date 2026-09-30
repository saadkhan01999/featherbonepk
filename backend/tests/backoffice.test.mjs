/**
 * Back office: catalogue, orders queue, customers, promotions, reports.
 */
import { API, OWNER_EMAIL, call, login, suite, PW, uniqueEmail, uniquePhone } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('backoffice');

  const superToken = await login(OWNER_EMAIL);
  const cashierToken = await login('cashier@featherandbone.dev');

  section('Search boxes escape regex metacharacters');
  // An unescaped search box is a regex-injection and ReDoS hole: ".*" would
  // match everything, and a crafted pattern can hang the database.
  for (const [label, path] of [
    ['orders', '/orders/admin/list?search=.*'],
    ['customers', '/customers?search=.*'],
  ]) {
    const injected = await call('GET', path, superToken);
    check(
      `${label} search treats ".*" as a literal`,
      injected.status === 200 && injected.body.data.length === 0,
      `got ${injected.body.data?.length} rows`,
    );
  }

  section('Order queue');
  const list = await call('GET', '/orders/admin/list?limit=5', superToken);
  check('queue loads', list.status === 200);
  const row = list.body.data?.[0];
  check(
    'rows carry a summary, not every line of every order',
    row && !('items' in row) && typeof row.summary === 'string',
  );
  check('no __v leaks', !JSON.stringify(list.body).includes('"__v"'));
  check('nextStatuses drives the action buttons', Array.isArray(row?.nextStatuses));

  section('Order transitions are whitelisted');
  const menu = await call('GET', '/catalog/products?limit=50', null);
  const product = (menu.body.data ?? []).find((p) => p.stock > 5 && !p.isWeighed);
  const email = uniqueEmail('queue');
  const custToken = (
    await call('POST', '/auth/register', null, {
      fullName: 'Queue Tester',
      email,
      phone: uniquePhone('0381'),
      password: PW,
    })
  ).body.data?.accessToken;

  const placed = await call('POST', '/orders', custToken, {
    items: [{ productId: product.id, quantity: 2 }],
    customer: { name: 'Queue Tester', phone: '03001234567' },
    deliveryAddress: { line1: 'Chota Chowk', city: 'Mardan' },
    paymentMethod: 'cod',
  });
  const orderNumber = placed.body.data.order.orderNumber;
  const stockAfterOrder = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;

  check(
    'cannot jump straight to delivered',
    (await call('PATCH', `/orders/${orderNumber}/status`, superToken, { status: 'delivered' })).status ===
      400,
  );
  check(
    'an unknown status is rejected',
    (await call('PATCH', `/orders/${orderNumber}/status`, superToken, { status: 'teleported' })).status >=
      400,
  );
  check(
    'a whitelisted move is allowed',
    (await call('PATCH', `/orders/${orderNumber}/status`, superToken, { status: 'preparing' })).status ===
      200,
  );

  await call('PATCH', `/orders/${orderNumber}/status`, superToken, { status: 'cancelled' });
  check(
    'cancelling returns stock',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === stockAfterOrder + 2,
  );
  check(
    'a cancelled order offers no further action',
    (await call('GET', `/orders/admin/list?search=${orderNumber}`, superToken)).body.data[0]?.nextStatuses
      .length === 0,
  );

  section('Customers are scoped away from staff');
  const customers = await call('GET', '/customers?limit=100', superToken);
  check('customer list loads', customers.status === 200);
  check('NO staff appear in it', !customers.body.data.some((c) => c.email.endsWith('@featherandbone.dev')));
  check(
    'no password or session data leaks',
    !JSON.stringify(customers.body).includes('"password"') &&
      !JSON.stringify(customers.body).includes('tokenHash'),
  );

  const staff = await call('GET', '/staff', superToken);
  check(
    'a staff id is NOT readable through the customer endpoint',
    (await call('GET', `/customers/${staff.body.data[0]?.id}`, superToken)).status === 404,
  );

  section('Suspending a customer revokes their sessions');
  const target = customers.body.data.find((c) => c.email === email);
  check('customer can use their account first', (await call('GET', '/account', custToken)).status === 200);
  check(
    'a cashier cannot suspend',
    (
      await call('PATCH', `/customers/${target.id}/status`, cashierToken, {
        status: 'suspended',
      })
    ).status === 403,
  );

  await call('PATCH', `/customers/${target.id}/status`, superToken, { status: 'suspended' });
  check(
    'suspension takes effect IMMEDIATELY',
    (await call('GET', '/account', custToken)).status === 403,
    'without revoking sessions, "suspended" means nothing until the token expires',
  );
  check(
    'and they cannot sign back in',
    (await call('POST', '/auth/login', null, { email, password: PW })).status === 403,
  );

  await call('PATCH', `/customers/${target.id}/status`, superToken, { status: 'active' });
  check('restoring works', (await call('POST', '/auth/login', null, { email, password: PW })).status === 200);

  section('Promotions: liveness is computed, not stored');
  const DAY = 86_400_000;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();

  const publicList = await call('GET', '/promotions', null);
  check('public offers load without a token', publicList.status === 200);
  check(
    'public payload hides scheduling internals',
    publicList.body.data.every((p) => !('isActive' in p) && !('startsAt' in p)),
  );

  check(
    'a customer cannot read unlaunched campaigns',
    (await call('GET', '/promotions/admin', custToken)).status === 403,
  );

  const expired = await call('POST', '/promotions', superToken, {
    kicker: 'Test',
    title: `Expired ${Date.now()}`,
    highlight: 'Gone',
    type: 'combo',
    image: '/images/products/photos/bbq.jpg',
    startsAt: iso(-2 * DAY),
    endsAt: iso(-1000),
  });
  const expiredId = expired.body.data?.id;
  check(
    'an offer past its end date reads "expired" with NO job having run',
    (await call('GET', '/promotions/admin', superToken)).body.data.find((p) => p.id === expiredId)?.state ===
      'expired',
  );
  check(
    'and it is not on the storefront',
    !(await call('GET', '/promotions', null)).body.data.some((p) => p.id === expiredId),
  );

  check(
    'a window that can never open is refused',
    (
      await call('POST', '/promotions', superToken, {
        kicker: 'Test',
        title: `Backwards ${Date.now()}`,
        highlight: 'Bad',
        type: 'combo',
        image: '/x.jpg',
        startsAt: iso(3 * DAY),
        endsAt: iso(DAY),
      })
    ).status >= 400,
  );

  const live = (await call('GET', '/promotions', null)).body.data[0];
  await call('PATCH', `/promotions/${live.id}`, superToken, { isActive: false });
  check(
    'pausing removes it from the storefront immediately',
    !(await call('GET', '/promotions', null)).body.data.some((p) => p.id === live.id),
  );
  await call('PATCH', `/promotions/${live.id}`, superToken, { isActive: true });
  check(
    'resuming puts it back',
    (await call('GET', '/promotions', null)).body.data.some((p) => p.id === live.id),
  );

  await call('DELETE', `/promotions/${expiredId}`, superToken);

  section('Reports');
  const csv = await fetch(
    // The harness address, never a hard-coded port: 7000 may be a real server.
    `${API}/reports/sales-summary/export?preset=month`,
    { headers: { Authorization: `Bearer ${superToken}` } },
  );
  check('CSV export succeeds', csv.status === 200, `got ${csv.status}`);
  const bytes = Buffer.from(await csv.arrayBuffer());
  check(
    'CSV starts with a UTF-8 BOM',
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    'without it Excel mangles the rupee sign and Urdu text',
  );
  check('CSV uses CRLF line endings', bytes.includes(Buffer.from('\r\n')));

  check(
    'a cashier cannot export reports',
    (await call('GET', '/reports/sales-summary?preset=today', cashierToken)).status === 403,
  );

  section('Table sorting is server-side and whitelisted');
  /*
   * Why this matters beyond tidiness. The product table is paginated, so
   * ordering has to happen in the database. Sorted in the browser instead, page
   * one would be sorted within itself and wrong against every other page —
   * which looks like it works.
   *
   * And the column name arrives from a URL. Passed straight to `.sort()` it
   * would let a stranger order by an unindexed field (a blocking in-memory sort
   * that simply fails past 32MB) or by a `select: false` field such as
   * costPrice, whose ascending and descending pages together reveal the margin
   * ranking that column is hidden to protect.
   */
  const prices = async (query) => {
    const res = await call('GET', `/admin/catalog/products?limit=20&${query}`, superToken);
    return (res.body.data ?? []).map((p) => p.price);
  };

  const ascending = await prices('sort=price:asc');
  const descending = await prices('sort=price:desc');
  const natural = await prices('');

  check(
    'price:asc really ascends',
    ascending.every((v, i) => i === 0 || ascending[i - 1] <= v),
    ascending.join(','),
  );
  check(
    'price:desc really descends',
    descending.every((v, i) => i === 0 || descending[i - 1] >= v),
    descending.join(','),
  );
  check(
    'the "-price" shorthand matches "price:desc"',
    JSON.stringify(await prices('sort=-price')) === JSON.stringify(descending),
  );

  check(
    'an unknown column falls back instead of erroring',
    JSON.stringify(await prices('sort=nonsense:desc')) === JSON.stringify(natural),
    'a stale bookmark should still render a list',
  );
  check(
    'a hidden column cannot be sorted on',
    JSON.stringify(await prices('sort=costPrice:desc')) === JSON.stringify(natural),
    'costPrice is select:false; ordering by it leaks the margin ranking',
  );

  const injected = await call(
    'GET',
    `/admin/catalog/products?limit=5&sort=${encodeURIComponent('{"$where":"1"}')}`,
    superToken,
  );
  check(
    'an injected sort object is ignored, not executed',
    injected.status === 200,
    `got ${injected.status}`,
  );

  const staffAsc = (await call('GET', '/staff?limit=50&sort=name:asc', superToken)).body.data.map(
    (u) => u.fullName,
  );
  const staffDesc = (await call('GET', '/staff?limit=50&sort=name:desc', superToken)).body.data.map(
    (u) => u.fullName,
  );
  check(
    'staff sorting works in both directions',
    staffAsc.length > 0 && JSON.stringify(staffAsc) === JSON.stringify([...staffDesc].reverse()),
    `${staffAsc.join(',')} vs ${staffDesc.join(',')}`,
  );

  return report();
}
