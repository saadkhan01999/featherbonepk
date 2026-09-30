/**
 * The four screens that used to say "coming soon".
 * ---------------------------------------------------------------------------
 * Website Management, Finance, System Logs and Notifications now have real
 * backends. This suite covers the parts that are easy to get wrong once and
 * never notice:
 *
 *   • Finance is the only report gated on `report.financial`. If that gate
 *     slips, every admin can read the margin on every dish.
 *   • The audit trail must be append-only. A log an administrator can edit is
 *     not evidence of anything.
 *   • Notifications are permission-filtered per item, so a cashier gets an
 *     empty list rather than a 403 — a dashboard widget that 403s looks broken.
 */
import { OWNER_EMAIL, suite, call, login, uniqueEmail, uniquePhone, PW } from './harness.mjs';

export default async function run() {
  const t = suite('admin-screens');
  const { check, section } = t;

  const superToken = await login(OWNER_EMAIL);
  const adminToken = await login('admin@featherandbone.dev');

  // --- Website Management --------------------------------------------------
  section('Website Management');

  const settings = await call('GET', '/settings', superToken);
  const content = (settings.body.data ?? []).find((s) => s.key === 'content');
  check('the content section exists', Boolean(content));

  const keys = (content?.fields ?? []).map((f) => f.key);
  check('hero fields are editable', keys.includes('heroTitle') && keys.includes('heroImage'));
  // The About figures live on the About Page tab, with the rest of that page.
  const about = (settings.body.data ?? []).find((s) => s.key === 'about');
  const aboutKeys = (about?.fields ?? []).map((f) => f.key);
  check(
    'about-page figures are editable',
    aboutKeys.includes('aboutStat1Value') && aboutKeys.includes('aboutStat1Label'),
    aboutKeys.join(', '),
  );

  /*
   * The About stats used to be hard-coded as "5+ Years", "100K+ Happy
   * Customers", "10+ Branches" — false claims on a public page for a business
   * that has just opened, correctable only by a developer.
   */
  const saved = await call('PATCH', '/settings/about', superToken, {
    aboutStat1Value: '3+',
    aboutStat1Label: 'Years Trading',
  });
  check('the owner can set a figure', saved.status === 200, `status ${saved.status}`);

  const publicSite = await call('GET', '/settings/public');
  // Nested under `content` — the public payload is grouped by concern.
  const stats = publicSite.body.data?.content?.aboutStats ?? [];
  check(
    'it reaches the public storefront',
    stats.some((s) => s.value === '3+' && s.label === 'Years Trading'),
    JSON.stringify(stats),
  );

  // A blank figure must be omitted, not rendered as an empty card.
  await call('PATCH', '/settings/about', superToken, { aboutStat1Value: '' });
  const cleared = await call('GET', '/settings/public');
  check(
    'a blank figure is hidden rather than shown empty',
    !(cleared.body.data?.content?.aboutStats ?? []).some((s) => s.label === 'Years Trading'),
  );

  // --- Finance -------------------------------------------------------------
  section('Finance');

  const pnl = await call('GET', '/reports/profit-and-loss?preset=month', superToken);
  check('the owner can read profit & loss', pnl.status === 200, `status ${pnl.status}`);

  const totals = pnl.body.data?.totals ?? {};
  check(
    'revenue, cost and profit are reported',
    ['revenue', 'cost', 'grossProfit'].every((k) => typeof totals[k] === 'number'),
    JSON.stringify(totals),
  );

  check(
    'gross profit equals revenue minus cost',
    Math.abs(totals.revenue - totals.cost - totals.grossProfit) < 1,
    `${totals.revenue} - ${totals.cost} != ${totals.grossProfit}`,
  );

  /*
   * A margin is a ratio, not a sum.
   *
   * The generic totals loop added up thirty daily percentages and produced a
   * footer reading "1048.5%" — arithmetically a sum and complete nonsense as a
   * figure. Ratios are now recomputed from the totals they are a ratio of.
   */
  const expectedMargin = totals.revenue
    ? Number((((totals.revenue - totals.cost) / totals.revenue) * 100).toFixed(1))
    : 0;
  check(
    'margin is recomputed, not summed',
    totals.margin === expectedMargin,
    `got ${totals.margin}%, expected ${expectedMargin}%`,
  );
  check(
    'margin is a plausible percentage',
    totals.margin <= 100 && totals.margin >= -100,
    `${totals.margin}%`,
  );

  const adminPnl = await call('GET', '/reports/profit-and-loss?preset=month', adminToken);
  check('an admin CANNOT read profit & loss', adminPnl.status === 403, `status ${adminPnl.status}`);

  const adminReports = await call('GET', '/reports', adminToken);
  check(
    'and it is absent from their report menu',
    !(adminReports.body.data ?? []).some((r) => r.id === 'profit-and-loss'),
    (adminReports.body.data ?? []).map((r) => r.id).join(', '),
  );

  // --- System Logs ---------------------------------------------------------
  section('System Logs (audit trail)');

  const hireEmail = uniqueEmail('audited');
  const hired = await call('POST', '/staff', superToken, {
    fullName: 'Audited Hire',
    email: hireEmail,
    password: PW,
    phone: uniquePhone(),
    role: 'cashier',
  });
  check('creating staff succeeds', hired.status === 201);

  const log = await call('GET', '/audit?module=staff', superToken);
  check('the audit trail is readable', log.status === 200);

  const entry = (log.body.data ?? []).find((e) => e.summary?.includes('Audited Hire'));
  check('creating an account is recorded', Boolean(entry), 'no matching entry');
  check('it is marked critical — this grants system access', entry?.severity === 'critical', entry?.severity);
  /*
   * The invariant is "an actual person is named", not any particular name —
   * which is also the bug this guards against. `actorOf` did not include
   * `fullName`, so every staff entry recorded the fallback "System", and an
   * audit log that cannot say who did something is decoration.
   *
   * Asserting the seeded owner's name instead would break every time the owner
   * is renamed, which says nothing about whether the audit works.
   */
  check(
    'it names a real person, not "System"',
    Boolean(entry?.actorName) && entry.actorName !== 'System',
    entry?.actorName,
  );

  // Price changes are the quiet way money goes missing.
  const product = (await call('GET', '/admin/catalog/products?limit=1', superToken)).body.data?.[0];
  const newPrice = product.price + 25;
  await call('PATCH', `/admin/catalog/products/${product.id}`, superToken, { price: newPrice });

  const priceLog = await call('GET', '/audit?module=catalog', superToken);
  const priceEntry = (priceLog.body.data ?? []).find((e) => e.changes?.price);
  check(
    'a price change is recorded with before and after',
    priceEntry?.changes?.price?.to === newPrice,
    JSON.stringify(priceEntry?.changes),
  );
  check('and flagged as worth noticing', priceEntry?.severity === 'warning', priceEntry?.severity);

  /*
   * Append-only. There is no write route at all — not a permission check that
   * could be misconfigured, but no handler to reach.
   */
  const tamper = await call('DELETE', `/audit/${entry?.id}`, superToken);
  check(
    'entries cannot be deleted',
    tamper.status === 404 || tamper.status === 405,
    `status ${tamper.status}`,
  );
  const forge = await call('POST', '/audit', superToken, { action: 'fake', module: 'staff', summary: 'x' });
  check('entries cannot be forged', forge.status === 404 || forge.status === 405, `status ${forge.status}`);

  const cashierToken = await login('cashier@featherandbone.dev');
  const cashierLog = await call('GET', '/audit', cashierToken);
  check('a cashier cannot read the audit trail', cashierLog.status === 403, `status ${cashierLog.status}`);

  // --- Notifications -------------------------------------------------------
  section('First-run setup guide');
  /*
   * A brand-new install opened on a dashboard of zeroes with no button on it
   * but the date filter — every figure describing a business that did not exist
   * yet, and nothing saying how to make it exist. The owner's first screen was
   * a dead end.
   *
   * The dashboard now carries a `setup` block that drives a checklist. These
   * assertions cover the two things that make it useful: it reports real
   * counts, and staff excludes the owner — counting the account you are signed
   * in as would tick "add your staff" before anyone had been hired.
   */
  const overview = await call('GET', '/dashboard/overview?days=30&period=daily', superToken);
  const setup = overview.body.data?.setup;

  check(
    'the dashboard reports setup progress',
    Boolean(setup),
    JSON.stringify(overview.body.data ?? {}).slice(0, 120),
  );
  check(
    'every step is a real count, not a guess',
    ['categories', 'products', 'terminals', 'staff'].every((k) => Number.isInteger(setup?.[k])),
    JSON.stringify(setup),
  );
  check(
    'the demo catalogue counts as set up',
    setup.categories > 0 && setup.products > 0,
    'the demo seed creates both, so these must not read zero',
  );

  /*
   * The owner must not count towards "add your staff". Checked by comparing
   * against the staff list, which does include them.
   */
  const allStaff = (await call('GET', '/staff?limit=100', superToken)).body.data ?? [];
  const owners = allStaff.filter((u) => u.role === 'super_admin').length;
  check(
    'the owner is excluded from the staff step',
    setup.staff === allStaff.length - owners,
    `setup.staff=${setup.staff}, staff list=${allStaff.length}, owners=${owners}`,
  );

  section('Notifications');

  const owner = await call('GET', '/notifications', superToken);
  check('the owner gets notifications', owner.status === 200);
  check(
    'each carries a severity and an action',
    (owner.body.data ?? []).every((n) => n.severity && n.title),
    JSON.stringify(owner.body.data?.[0]),
  );

  check(
    'urgent ones sort first',
    (owner.body.data ?? []).every((n, i, arr) => {
      if (i === 0) return true;
      const rank = { critical: 0, warning: 1, info: 2 };
      return rank[arr[i - 1].severity] <= rank[n.severity];
    }),
  );

  const count = await call('GET', '/notifications/count', superToken);
  check(
    'the badge count matches the list',
    count.body.data?.total === (owner.body.data ?? []).length,
    `${count.body.data?.total} vs ${(owner.body.data ?? []).length}`,
  );

  /*
   * A cashier gets 200 with a filtered list, not a 403. A dashboard widget that
   * 403s looks broken; one that is quiet is simply not relevant to them.
   */
  /*
   * The bell badge must be able to reach zero.
   *
   * It used to count every visible alert, and these alerts describe conditions
   * that last for days — so the badge showed a number permanently, no matter
   * how many times it was clicked. A badge that never clears is one people stop
   * looking at, which costs you the one time it mattered.
   *
   * Reading stores each alert's signature (its current count), so:
   *   • read now      → unread 0
   *   • count worsens → unread again, because that is news
   *   • count improves→ still read, because being nagged for fixing something
   *                     is how a badge earns itself ignored
   */
  await call('POST', '/notifications/read', superToken);
  const afterRead = await call('GET', '/notifications/count', superToken);
  check(
    'reading clears the badge',
    afterRead.body.data?.unread === 0,
    `unread=${afterRead.body.data?.unread}`,
  );
  check(
    'but the alerts are still listed',
    (await call('GET', '/notifications', superToken)).body.data.length > 0,
    'clearing the badge must not hide the problems themselves',
  );

  check(
    'every alert reports itself read',
    (await call('GET', '/notifications', superToken)).body.data.every((n) => n.isRead),
  );

  // A brand-new problem must light the badge again.
  const bellCat = (await call('GET', '/admin/catalog/categories', superToken)).body.data[0];
  const bellStamp = Date.now();
  const bellProduct = await call('POST', '/admin/catalog/products', superToken, {
    name: `BellTest ${bellStamp}`,
    category: bellCat.id ?? bellCat._id,
    price: 100,
    unit: 'pcs',
    stock: 0,
    lowStockThreshold: 5,
    barcode: String(bellStamp).slice(-11),
  });

  const afterNew = await call('GET', '/notifications/count', superToken);
  check(
    'a NEW problem lights the badge again',
    afterNew.body.data?.unread > 0,
    `unread=${afterNew.body.data?.unread} after taking an item out of stock`,
  );

  // …and fixing it must not.
  await call('POST', '/notifications/read', superToken);
  await call('PATCH', `/admin/catalog/products/${bellProduct.body.data.id}`, superToken, { stock: 500 });
  const afterFix = await call('GET', '/notifications/count', superToken);
  check(
    'fixing the problem does NOT re-alert',
    afterFix.body.data?.unread === 0,
    `unread=${afterFix.body.data?.unread} — an improvement is not news`,
  );

  await call('DELETE', `/admin/catalog/products/${bellProduct.body.data.id}`, superToken);

  const cashierNotifications = await call('GET', '/notifications', cashierToken);
  check(
    'a cashier gets 200, not 403',
    cashierNotifications.status === 200,
    `status ${cashierNotifications.status}`,
  );
  check(
    'and is not shown things they cannot act on',
    !(cashierNotifications.body.data ?? []).some((n) => n.id === 'reviews:pending'),
    (cashierNotifications.body.data ?? []).map((n) => n.id).join(', '),
  );

  return t.report();
}
