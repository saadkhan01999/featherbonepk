/**
 * POS: till registry, sales, shifts and the cash drawer.
 * Everything here touches money or stock.
 */
import { randomUUID } from 'node:crypto';

import { OWNER_EMAIL, call, login, posLogin, suite } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('pos');

  const superToken = await login(OWNER_EMAIL);
  const code = `TILL-T${String(Date.now()).slice(-5)}`;

  section('Till registry gates sign-in');
  check(
    'an UNREGISTERED terminal is refused',
    (await posLogin('cashier@featherandbone.dev', 'TILL-NOT-REAL')).status === 403,
  );
  // TILL-04 is the seeded out-of-service spare. (TILL-03 used to be, before the
  // tills were assigned to counters and it became the live chicken counter.)
  check(
    'a DISABLED terminal is refused',
    (await posLogin('cashier@featherandbone.dev', 'TILL-04')).status === 403,
  );

  const badCreds = await call('POST', '/auth/pos/login', null, {
    email: 'cashier@featherandbone.dev',
    password: 'Wrong!123',
    terminalId: 'TILL-NOT-REAL',
  });
  check(
    'bad credentials fail BEFORE the terminal is checked',
    badCreds.status === 401,
    'otherwise the registry is enumerable without an account',
  );

  const lower = await posLogin('cashier@featherandbone.dev', 'till-01');
  check('a lowercase code works', lower.status === 200);
  check(
    'the canonical uppercase code is used',
    lower.body.data?.terminal?.id === 'TILL-01',
    'otherwise one till records sales under two names',
  );

  section('Registering a till');
  const created = await call('POST', '/terminals', superToken, {
    code: code.toLowerCase(),
    name: 'Test Till',
    location: 'Test bench',
  });
  check('a till can be registered', created.status === 201, JSON.stringify(created.body).slice(0, 140));
  check('the code is stored uppercase', created.body.data?.code === code);
  const terminalId = created.body.data.id;

  check(
    'a duplicate code is refused',
    (await call('POST', '/terminals', superToken, { code, name: 'Dupe' })).status === 409,
  );
  check(
    'the code is IMMUTABLE',
    (await call('PATCH', `/terminals/${terminalId}`, superToken, { code: 'TILL-RENAMED' })).status === 400,
    'renaming would orphan every sale recorded against it',
  );

  section('Sales work WITHOUT a shift (drawer removed)');
  const session = await posLogin('cashier@featherandbone.dev', code);
  const posToken = session.body.data.posToken;

  const menu = await call('GET', '/catalog/products?limit=50', null);
  const product = (menu.body.data ?? []).find((p) => p.stock > 10 && !p.isWeighed);

  // The cash drawer was removed at the owner's request: the till sells and
  // prints, it does not reconcile a float. Sales must therefore not depend on a
  // shift — but attribution must survive, which is asserted below.
  const noShift = await call('POST', '/pos/sales', posToken, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: 99999,
  });
  check(
    'a sale succeeds with no shift open',
    noShift.status === 201,
    JSON.stringify(noShift.body).slice(0, 160),
  );
  check('the cashier is still recorded', Boolean(noShift.body.data?.cashierName));
  check(
    'the terminal is still recorded',
    noShift.body.data?.terminalId === code,
    'attribution comes from the POS token, not the shift',
  );

  section('Server prices the sale');
  const quote = await call('POST', '/pos/quote', posToken, {
    items: [{ productId: product.id, quantity: 2 }],
  });
  check('subtotal from DB prices', quote.body.data.subtotal === product.effectivePrice * 2);

  const overDiscount = await call('POST', '/pos/quote', posToken, {
    items: [{ productId: product.id, quantity: 2 }],
    discount: 999999,
  });
  check(
    'a discount is clamped to the subtotal',
    overDiscount.body.data.discount === quote.body.data.subtotal,
  );
  check('the total floors at zero, never negative', overDiscount.body.data.total === 0);

  section('Recording a sale');
  const stockBefore = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;
  const saleRef = randomUUID();
  const sale = await call('POST', '/pos/sales', posToken, {
    saleRef,
    items: [{ productId: product.id, quantity: 2 }],
    paymentMethod: 'cash',
    tendered: 99999,
  });
  check('sale recorded', sale.status === 201, JSON.stringify(sale.body).slice(0, 160));
  // Exactly six suffix characters, not "four or more". The width is the
  // guarantee: at four, 36⁴ values a day collided often enough that a busy
  // till would hit the unique index with the cash already taken.
  check(
    'the SERVER issues the invoice number',
    /^INV-\d{8}-[A-Z0-9]{6}$/.test(sale.body.data?.invoiceNumber ?? ''),
    sale.body.data?.invoiceNumber,
  );
  check('change is computed', sale.body.data.changeDue === 99999 - quote.body.data.total);
  check(
    'stock moved',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === stockBefore - 2,
  );

  section('Idempotency');
  const replay = await call('POST', '/pos/sales', posToken, {
    saleRef,
    items: [{ productId: product.id, quantity: 2 }],
    paymentMethod: 'cash',
    tendered: 99999,
  });
  check('replaying the same saleRef returns 200, not 201', replay.status === 200);
  check('the SAME invoice comes back', replay.body.data?.invoiceNumber === sale.body.data.invoiceNumber);
  check(
    'stock is NOT decremented twice',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === stockBefore - 2,
  );

  section('Sale guards');
  check(
    'cash under the total is refused',
    (
      await call('POST', '/pos/sales', posToken, {
        saleRef: randomUUID(),
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'cash',
        tendered: 1,
      })
    ).status === 400,
  );
  check(
    'bank transfer is not offered at a counter',
    (
      await call('POST', '/pos/sales', posToken, {
        saleRef: randomUUID(),
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'bank_transfer',
      })
    ).status >= 400,
  );
  check(
    'a sale without an idempotency key is refused',
    (
      await call('POST', '/pos/sales', posToken, {
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'cash',
      })
    ).status >= 400,
  );

  section('Shift API still works, but is no longer required');
  /*
   * The cash drawer was removed from the till UI at the owner's request. The
   * shift module is deliberately kept and still tested at this level, so it
   * does not silently rot before someone wants reconciliation back.
   */
  const cashSaleTotal = sale.body.data.totals.total;

  const opened = await call('POST', '/pos/shift/open', posToken, { openingFloat: 5000 });
  check('a shift can still be opened', opened.status === 201, JSON.stringify(opened.body).slice(0, 140));
  check(
    'a second shift on the same till is still refused',
    (await call('POST', '/pos/shift/open', posToken, { openingFloat: 1000 })).status === 409,
  );

  const inShift = await call('POST', '/pos/sales', posToken, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: 99999,
  });
  check('a sale made during a shift attaches to it', inShift.status === 201);

  const shift = (await call('GET', '/pos/shift', posToken)).body.data;
  check(
    'only the in-shift sale counts toward the drawer',
    shift.expectedCash === 5000 + inShift.body.data.totals.total,
    `${shift.expectedCash} — the earlier shift-less sale must NOT be counted`,
  );
  check(
    'the pre-shift sale is excluded',
    shift.expectedCash !== 5000 + cashSaleTotal + inShift.body.data.totals.total,
  );

  const closed = await call('POST', '/pos/shift/close', posToken, { countedCash: shift.expectedCash - 250 });
  check('a shortfall is still recorded, not corrected', closed.body.data.variance === -250);

  check(
    'selling STILL works after the shift closes',
    (
      await call('POST', '/pos/sales', posToken, {
        saleRef: randomUUID(),
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'cash',
        tendered: 99999,
      })
    ).status === 201,
    'closing a shift must no longer stop the till trading',
  );

  section('Disabling a till mid-shift');
  await call('POST', '/pos/shift/open', posToken, { openingFloat: 1000 });
  const blocked = await call('PATCH', `/terminals/${terminalId}/active`, superToken, { isActive: false });
  check(
    'refused while a shift is open',
    blocked.status === 409,
    'it would strand cash in a drawer nobody can reconcile',
  );

  section('Tidy up');
  await call('POST', '/pos/shift/close', posToken, { countedCash: 0 });
  check(
    'closing twice is still refused',
    (await call('POST', '/pos/shift/close', posToken, { countedCash: 0 })).status === 400,
  );

  section('History is protected');
  check(
    'a till WITH SALES cannot be deleted',
    (await call('DELETE', `/terminals/${terminalId}`, superToken)).status === 409,
    'sales are financial records',
  );
  check(
    'but it CAN be disabled now the shift is closed',
    (await call('PATCH', `/terminals/${terminalId}/active`, superToken, { isActive: false })).status === 200,
  );

  section('POS sales reach the owner reports');
  const reportRows = await call('GET', '/reports/sales-summary?preset=today', superToken);
  check('report loads', reportRows.status === 200);
  check(
    'the POS channel appears',
    JSON.stringify(reportRows.body.data?.rows ?? [])
      .toLowerCase()
      .includes('pos'),
    'a till sale that never reaches a report is the bug the module was written to fix',
  );

  return report();
}
