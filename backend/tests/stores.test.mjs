/**
 * Store (outlet) scoping.
 * ---------------------------------------------------------------------------
 * The business trades from several counters under one roof. Each has its own
 * till, its own menu and its own takings, and the owner wants to read them
 * separately — bakery figures for the bakery, chicken figures for the chicken
 * counter.
 *
 * The load-bearing test in this file is cross-store sale refusal.
 *
 * Scoping `/pos/products` only hides another counter's goods from the screen. A
 * verification run proved the chicken till could still POST a bakery product id
 * and successfully sell a Naan — depleting bakery stock and banking bakery money
 * against the chicken counter, with the UI showing nothing wrong. Hiding is not
 * enforcing. This suite exists so that cannot quietly return.
 */
import { OWNER_EMAIL, suite, call, login, posLogin, uniqueEmail, uniquePhone, PW } from './harness.mjs';

export default async function run() {
  const t = suite('stores');
  const { check, section } = t;

  const superToken = await login(OWNER_EMAIL);
  const adminToken = await login('admin@featherandbone.dev');

  // --- The registry --------------------------------------------------------
  section('Store registry');

  const stores = await call('GET', '/stores', superToken);
  const rows = stores.body.data ?? [];
  check('owner can list the counters', stores.status === 200 && rows.length >= 3, `got ${rows.length}`);

  const bakery = rows.find((s) => s.code === 'BAKERY');
  const chicken = rows.find((s) => s.code === 'CHICKEN');
  check('BAKERY and CHICKEN are seeded', Boolean(bakery && chicken));
  if (!bakery || !chicken) return t.report();

  check(
    'a store row carries its own counts',
    bakery.terminalCount >= 1 && bakery.productCount >= 1,
    `tills=${bakery.terminalCount} products=${bakery.productCount}`,
  );

  // --- Who may redraw the map ---------------------------------------------
  const adminRead = await call('GET', '/stores', adminToken);
  check('an admin may READ the store list', adminRead.status === 200);

  const adminWrite = await call('POST', '/stores', adminToken, {
    code: 'ESCALATE',
    name: 'Should not exist',
    type: 'general',
  });
  check('an admin may NOT create a store', adminWrite.status === 403, `got ${adminWrite.status}`);

  // --- The till's menu is decided by the terminal, not the cashier ---------
  section('Per-till menu');

  const bakeryTill = await posLogin('cashier@featherandbone.dev', 'TILL-02');
  const chickenTill = await posLogin('cashier@featherandbone.dev', 'TILL-03');
  const bToken = bakeryTill.body.data?.posToken;
  const cToken = chickenTill.body.data?.posToken;
  check('both tills sign in', Boolean(bToken && cToken));
  if (!bToken || !cToken) return t.report();

  const posMenu = async (token) => (await call('GET', '/pos/products?limit=200', token)).body.data ?? [];
  const bakeryMenu = await posMenu(bToken);
  const chickenMenu = await posMenu(cToken);
  const names = (list) => list.map((p) => p.name);

  check('the bakery till sells naan', names(bakeryMenu).includes('Naan'));
  check('the chicken till does NOT', !names(chickenMenu).includes('Naan'));
  check('the chicken till sells tikka', names(chickenMenu).includes('Chicken Tikka'));
  check('the bakery till does NOT', !names(bakeryMenu).includes('Chicken Tikka'));

  // Drinks and sides exist once in stock and are rung up wherever the customer
  // happens to be standing. `store: null` is the normal case, not a leftover.
  check(
    'unassigned goods appear at every till',
    names(bakeryMenu).includes('Coke Drink') && names(chickenMenu).includes('Coke Drink'),
  );

  // Filter chips must match the grid. A "Roast Chicken" chip on the bakery till
  // yields an empty result, and a control that does nothing is worse than an
  // absent one — the cashier retries it and doubts the terminal.
  const posCats = async (token) => (await call('GET', '/pos/categories', token)).body.data ?? [];
  const bakeryCats = names(await posCats(bToken));
  const chickenCats = names(await posCats(cToken));

  /*
   * The invariant is that the chips match the grid — not that a particular
   * category is absent.
   *
   * An earlier version asserted "the chicken till has no Bakery chip", which
   * broke the moment a bakery-category item was set to sell at every counter:
   * the chip then appeared correctly and the test failed on working code. A
   * category is not owned by a counter; it simply has items there.
   */
  const categoriesInGrid = (menu) => new Set(menu.map((p) => p.category?.name).filter(Boolean));

  const chipsMatchGrid = (chips, menu) => {
    const present = categoriesInGrid(menu);
    // Every chip must select something, and everything on the grid must be
    // reachable by a chip. Either gap is a control that lies to the cashier.
    return chips.every((c) => present.has(c)) && [...present].every((c) => chips.includes(c));
  };

  check(
    'bakery chips exactly match the bakery grid',
    chipsMatchGrid(bakeryCats, bakeryMenu),
    bakeryCats.join(', '),
  );
  check(
    'chicken chips exactly match the chicken grid',
    chipsMatchGrid(chickenCats, chickenMenu),
    chickenCats.join(', '),
  );

  // The seeded separation itself. Every roast-chicken item is scoped to the
  // chicken counter, so that chip belongs there and nowhere else.
  check(
    'a counter-specific category stays on its own till',
    chickenCats.includes('Roast Chicken') && !bakeryCats.includes('Roast Chicken'),
    `bakery=[${bakeryCats}] chicken=[${chickenCats}]`,
  );
  check(
    'shared categories appear at both',
    bakeryCats.includes('Beverages') && chickenCats.includes('Beverages'),
  );

  const naan = bakeryMenu.find((p) => p.name === 'Naan');
  const tikka = chickenMenu.find((p) => p.name === 'Chicken Tikka');

  /*
   * Pick the shared item by stock, not by name.
   *
   * This used to hard-code "Coke Drink", which made the assertion depend on one
   * named product still having stock — in a suite that shares a mutating
   * database with seven others. Anything that sold the last Coke (another test,
   * or a manual probe) broke an unrelated assertion about store scoping, which
   * is a misleading failure: the scoping was fine, the shelf was empty.
   */
  const coke = chickenMenu.find((p) => !p.store && p.stock > 2);
  check(
    'a shared item with stock is available to sell',
    Boolean(coke),
    'every store-less product is out of stock',
  );

  // Scanning is scoped too. Catching this only at payment would mean the
  // customer has already been quoted a total that the server will refuse.
  const scanHere = await call('GET', `/pos/products/resolve?code=${naan.barcode}`, bToken);
  check('a barcode scans at its own counter', scanHere.status === 200);

  const scanThere = await call('GET', `/pos/products/resolve?code=${naan.barcode}`, cToken);
  check('the same barcode does NOT scan elsewhere', scanThere.status === 404, `status ${scanThere.status}`);

  // --- Enforcement, not presentation --------------------------------------
  section('Cross-store enforcement');

  const crossSale = await call('POST', '/pos/sales', cToken, {
    saleRef: `xstore-${Date.now()}`,
    items: [{ productId: naan.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: naan.price * 2 + 1000,
  });
  // 422, not 400: the request is well-formed, but the basket cannot be priced
  // at this counter — the API answers unprocessable with per-line detail.
  check(
    'a till cannot SELL another counter’s goods',
    crossSale.status === 422 && /not sold at this counter/i.test(JSON.stringify(crossSale.body)),
    `status ${crossSale.status}`,
  );

  // Guarding only the sale would let the slip print a total the server then
  // refuses — the cashier would be told the price, take the money, and fail.
  const crossQuote = await call('POST', '/pos/quote', cToken, {
    items: [{ productId: naan.id, quantity: 1 }],
  });
  check(
    'a till cannot even QUOTE another counter’s goods',
    crossQuote.status === 422 && /not sold at this counter/i.test(JSON.stringify(crossQuote.body)),
    `status ${crossQuote.status}`,
  );

  const sharedSale = await call('POST', '/pos/sales', cToken, {
    saleRef: `shared-${Date.now()}`,
    items: [{ productId: coke.id, quantity: 1 }],
    paymentMethod: 'cash',
    // Derived, not a fixed 500: the item is now chosen by stock, so its price
    // is unknown here and a hard-coded tender fails as "insufficient cash" —
    // a confusing way for a store-scoping test to break.
    tendered: coke.price * 2 + 1000,
  });
  check('shared goods still sell at any till', sharedSale.status === 201, `status ${sharedSale.status}`);

  const ownSale = await call('POST', '/pos/sales', cToken, {
    saleRef: `own-${Date.now()}`,
    items: [{ productId: tikka.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: tikka.price * 2 + 1000,
  });
  check('own-counter goods still sell', ownSale.status === 201, `status ${ownSale.status}`);

  // --- The website is deliberately not scoped -----------------------------
  const web = await call('GET', '/catalog/products?limit=100');
  const webNames = names(web.body.data ?? []);
  check(
    'the public menu shows every counter',
    webNames.includes('Naan') && webNames.includes('Chicken Tikka'),
  );

  // --- Moving a till moves its menu ----------------------------------------
  section('Till assignment');

  const tills = (await call('GET', '/terminals', superToken)).body.data ?? [];
  const till02 = tills.find((x) => x.code === 'TILL-02');
  check(
    'the registry names each till’s counter',
    till02?.storeName === bakery.name,
    `TILL-02 -> ${till02?.storeName}`,
  );

  const menuNamesFor = async (token) =>
    names((await call('GET', '/pos/products?limit=200', token)).body.data ?? []);

  // Reassign, re-sign-in (the scope lives in the token, so an existing session
  // legitimately keeps the old menu until the cashier signs in again).
  await call('PATCH', `/terminals/${till02.id}`, superToken, { store: chicken.id });
  const movedTill = (await posLogin('cashier@featherandbone.dev', 'TILL-02')).body.data?.posToken;
  const movedMenu = await menuNamesFor(movedTill);
  check(
    'a reassigned till gets the new counter’s menu',
    movedMenu.includes('Chicken Tikka') && !movedMenu.includes('Naan'),
  );

  /*
   * An unassigned till is unscoped — it sells the whole catalogue.
   *
   * Deliberate: a business that has not divided itself into counters has no
   * stores, and scoping those tills to "global goods only" would leave them
   * with an empty menu. The trade-off is stated on the POS Management screen.
   */
  await call('PATCH', `/terminals/${till02.id}`, superToken, { store: null });
  const loose = (await posLogin('cashier@featherandbone.dev', 'TILL-02')).body.data?.posToken;
  const looseMenu = await menuNamesFor(loose);
  check(
    'an unassigned till is unscoped, not empty',
    looseMenu.includes('Naan') && looseMenu.includes('Chicken Tikka'),
    `${looseMenu.length} items`,
  );

  // Put it back, or every later assertion in this file reads the wrong menu.
  await call('PATCH', `/terminals/${till02.id}`, superToken, { store: bakery.id });
  const restored = (await posLogin('cashier@featherandbone.dev', 'TILL-02')).body.data?.posToken;
  check('and can be assigned back', (await menuNamesFor(restored)).includes('Naan'));

  // --- The owner assigns goods to a counter --------------------------------
  section('Owner assigns an item to a counter');

  const adminCats = (await call('GET', '/admin/catalog/categories', superToken)).body.data ?? [];
  const bakeryCat = adminCats.find((c) => c.name === 'Bakery');

  const made = await call('POST', '/admin/catalog/products', superToken, {
    name: `Cinnamon Roll ${Date.now()}`,
    category: bakeryCat?.id,
    store: bakery.id,
    price: 180,
    unit: 'pcs',
    stock: 40,
    barcode: String(89099000 + (Date.now() % 100000))
      .slice(0, 13)
      .padEnd(13, '0'),
  });
  check('the owner can add an item for one counter', made.status === 201, `status ${made.status}`);

  const newItem = made.body.data?.name;
  const menuNames = async (token) =>
    names((await call('GET', '/pos/products?limit=200', token)).body.data ?? []);

  check('it appears on that counter’s till', (await menuNames(bToken)).includes(newItem));
  check('and NOT on the others', !(await menuNames(cToken)).includes(newItem));

  // `store: null` must be settable, not merely omittable — otherwise an item
  // can be assigned to a counter but never moved back.
  const moved = await call('PATCH', `/admin/catalog/products/${made.body.data?.id}`, superToken, {
    store: null,
  });
  check('it can be moved back to every counter', moved.status === 200, `status ${moved.status}`);
  check(
    'and then shows at every till',
    (await menuNames(bToken)).includes(newItem) && (await menuNames(cToken)).includes(newItem),
  );

  // A mistyped id must fail loudly. Stored silently, the item would belong to a
  // store that is not there: on no till, in no figures, yet apparently saved.
  const ghost = await call('POST', '/admin/catalog/products', superToken, {
    name: 'Ghost Item',
    category: bakeryCat?.id,
    store: '0123456789abcdef01234567',
    price: 10,
    unit: 'pcs',
  });
  check('a non-existent store is refused', ghost.status === 400, `status ${ghost.status}`);

  // --- Reporting -----------------------------------------------------------
  section('Per-counter reporting');

  const all = await call('GET', '/reports/sales-summary?preset=today', superToken);
  const one = await call('GET', `/reports/sales-summary?preset=today&store=${bakery.id}`, superToken);

  check('unscoped report is marked unscoped', all.body.data?.storeScoped === false);
  check('scoped report is marked scoped', one.body.data?.storeScoped === true);
  check(
    'one counter cannot out-earn the whole business',
    (one.body.data?.totals?.revenue ?? 0) <= (all.body.data?.totals?.revenue ?? 0),
  );

  // --- Assignment confines, and does so loudly ----------------------------
  section('Assigned staff are confined');

  const managerEmail = uniqueEmail('bakerymgr');
  const created = await call('POST', '/staff', superToken, {
    fullName: 'Bakery Manager',
    email: managerEmail,
    password: PW,
    phone: uniquePhone(),
    role: 'manager',
    stores: [bakery.id],
  });
  check('owner can assign a manager to one counter', created.status === 201, `status ${created.status}`);

  const mgrToken = await login(managerEmail);
  check('the assigned manager can sign in', Boolean(mgrToken));

  const mgrDefault = await call('GET', '/reports/sales-summary?preset=today', mgrToken);
  check(
    'their own counter is IMPOSED when they name none',
    mgrDefault.body.data?.storeScoped === true && mgrDefault.body.data?.store === bakery.id,
    `store=${mgrDefault.body.data?.store}`,
  );

  /*
   * The failure this guards against is a silent widening: an unauthorised
   * `?store=` being ignored and the query running unscoped, which hands the
   * manager every counter's takings while the screen looks perfectly normal.
   */
  const mgrOther = await call('GET', `/reports/sales-summary?preset=today&store=${chicken.id}`, mgrToken);
  check(
    'asking for another counter is REFUSED, not widened',
    mgrOther.status === 403,
    `status ${mgrOther.status}`,
  );

  const mgrOwn = await call('GET', `/reports/sales-summary?preset=today&store=${bakery.id}`, mgrToken);
  check('naming their own counter is allowed', mgrOwn.body.data?.store === bakery.id);

  // `stores: []` means head office. It must not read as "assigned to nothing,
  // therefore show nothing" — the whole back office would go blank.
  const adminReport = await call('GET', '/reports/sales-summary?preset=today', adminToken);
  check('an unassigned admin reads across all counters', adminReport.body.data?.storeScoped === false);

  section('Website and till can carry different items on ONE stock count');
  /*
   * The shop needs different things on the two surfaces — fresh naan is rung up
   * at the counter but makes no sense to ship. The tempting fix is a separate
   * POS catalogue; it is the wrong one, because two catalogues means two stock
   * counts, and two stock counts disagree the first busy afternoon.
   *
   * `channels` hides an item on one surface while both keep drawing down the
   * same stock. The final check is the one that matters.
   */
  const chCat = (await call('GET', '/admin/catalog/categories', superToken)).body.data[0];
  const mark = Date.now();
  const mkProduct = (name, channels, barcode) =>
    call('POST', '/admin/catalog/products', superToken, {
      name,
      category: chCat.id ?? chCat._id,
      price: 500,
      unit: 'pcs',
      stock: 20,
      barcode,
      channels,
    });

  const webItem = await mkProduct(`ChanWeb ${mark}`, ['web'], String(mark).slice(-10));
  const tillItem = await mkProduct(`ChanTill ${mark}`, ['pos'], String(mark + 1).slice(-10));
  const bothItem = await mkProduct(`ChanBoth ${mark}`, ['web', 'pos'], String(mark + 2).slice(-10));
  check(
    'items can be created per channel',
    [webItem, tillItem, bothItem].every((r) => r.status === 201),
    [webItem, tillItem, bothItem].map((r) => r.status).join(','),
  );

  const noChannel = await mkProduct(`ChanNone ${mark}`, [], String(mark + 3).slice(-10));
  check(
    'an item sold NOWHERE is refused',
    noChannel.status >= 400,
    'an empty channel list is a deletion wearing a disguise',
  );

  const publicNames = (await call('GET', '/catalog/products?limit=100', null)).body.data.map((p) => p.name);
  check('the website shows its own item', publicNames.includes(`ChanWeb ${mark}`));
  check('the website hides the till-only item', !publicNames.includes(`ChanTill ${mark}`));

  const forced = (await call('GET', '/catalog/products?limit=100&channel=pos', null)).body.data.map(
    (p) => p.name,
  );
  check(
    '?channel=pos cannot be forced on the public API',
    !forced.includes(`ChanTill ${mark}`),
    'the public endpoint pins its own channel; a client must not get to choose',
  );

  const chanTill = (await posLogin(OWNER_EMAIL)).body.data.posToken;
  const tillNames = (await call('GET', '/pos/products?limit=100', chanTill)).body.data.map((p) => p.name);
  check('the till shows its own item', tillNames.includes(`ChanTill ${mark}`));
  check('the till hides the web-only item', !tillNames.includes(`ChanWeb ${mark}`));

  const scanWebAtTill = await call('GET', `/pos/products/resolve?code=${String(mark).slice(-10)}`, chanTill);
  check(
    'a web-only barcode does not scan at the counter',
    scanWebAtTill.status >= 400,
    String(scanWebAtTill.status),
  );

  await call('POST', '/pos/sales', chanTill, {
    items: [{ productId: bothItem.body.data.id, quantity: 3 }],
    paymentMethod: 'cash',
    tendered: 99999,
    saleRef: `CHAN-${mark}`,
  });
  const afterSale = (await call('GET', '/catalog/products?limit=100', null)).body.data.find(
    (p) => p.name === `ChanBoth ${mark}`,
  );
  check(
    'a till sale moves the stock the WEBSITE reports',
    afterSale?.stock === 17,
    `20 - 3 should be 17; the website says ${afterSale?.stock}. Two counts have appeared.`,
  );

  /*
   * Clean up. These three products are global (no store), so they are visible
   * at every counter — and they sit in the first category, which makes that
   * category appear on every till's chip row. Left behind, they break the
   * earlier "a counter-specific category stays on its own till" check the next
   * time this suite runs against the same database.
   *
   * A test that leaves data behind is a bug generator, not a safety net.
   *
   * ChanBoth is archived rather than removed, and that is fine: it was sold a
   * few lines above, and the catalogue deliberately archives anything with
   * sales history instead of deleting it (an order that references a vanished
   * product is a hole in the ledger). Archived means inactive, so it no longer
   * reaches any till — which is all this cleanup needs. Verified by running the
   * suite twice against the same database.
   */
  for (const created of [webItem, tillItem, bothItem]) {
    if (created.body?.data?.id) {
      await call('DELETE', `/admin/catalog/products/${created.body.data.id}`, superToken);
    }
  }

  return t.report();
}
