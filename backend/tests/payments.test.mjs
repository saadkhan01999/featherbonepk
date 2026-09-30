/**
 * Online payment, held stock, and who may cancel an order.
 * ---------------------------------------------------------------------------
 * The scenario this suite exists for:
 *
 *   stock = 1  →  customer starts an online payment  →  stock is held  →
 *   customer closes the tab and never pays  →  ???
 *
 * The wrong answer is "the item is out of stock forever", which is what happens
 * when nothing ever releases the hold. Every check below is about the boundary
 * between releasing it too late (an item nobody can buy) and releasing it too
 * eagerly (cancelling an order someone has actually paid for).
 *
 * Runs against the JazzCash provider with development credentials — see
 * fixtures/payments.seed.js. The signature maths is the real implementation, so
 * a callback signed with the configured salt verifies and one signed with
 * anything else does not.
 */
import { createHmac } from 'node:crypto';

import { suite, call, login, uniqueEmail, uniquePhone, waitFor, PW, OWNER_EMAIL } from './harness.mjs';
import { DEV_JAZZCASH } from './fixtures/payments.seed.js';

/**
 * Sign a callback the way JazzCash does: HMAC-SHA256 over the field values,
 * ordered by field name, empty values omitted, salted at the front.
 *
 * Written out here rather than imported from the provider on purpose — a test
 * that reuses the implementation it is checking would still pass if that
 * implementation were wrong in the same way twice.
 */
function sign(fields, salt) {
  const values = Object.keys(fields)
    .filter((key) => key !== 'pp_SecureHash')
    .sort((a, b) => a.localeCompare(b))
    .filter((key) => String(fields[key] ?? '').length > 0)
    .map((key) => String(fields[key]));

  return createHmac('sha256', salt)
    .update(`${salt}&${values.join('&')}`)
    .digest('hex')
    .toUpperCase();
}

/** Build a signed gateway callback for an order. */
function callbackFor(order, { responseCode = '000', amount = null, salt = DEV_JAZZCASH.integritySalt } = {}) {
  const fields = {
    pp_TxnRefNo: `T${Date.now()}`,
    pp_Amount: String(Math.round((amount ?? order.total) * 100)),
    pp_BillReference: order.orderNumber,
    ppmpf_1: order.orderNumber,
    pp_ResponseCode: responseCode,
    pp_ResponseMessage: responseCode === '000' ? 'Thank you for using JazzCash' : 'Transaction declined',
  };
  fields.pp_SecureHash = sign(fields, salt);
  return fields;
}

export default async function run() {
  const { check, section, report } = suite('payments');

  const superToken = await login(OWNER_EMAIL);

  const customerEmail = uniqueEmail('payer');
  const custToken = (
    await call('POST', '/auth/register', null, {
      fullName: 'Paying Customer',
      email: customerEmail,
      phone: uniquePhone('0345'),
      password: PW,
    })
  ).body.data?.accessToken;

  const products = (await call('GET', '/catalog/products?limit=5', null)).body.data;
  const product = products.find((p) => p.stock > 6) ?? products[0];

  const stockOf = async () => (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;

  const GUEST_PHONE = '03009998877';

  /** Place a gateway (unpaid, stock-holding) order. */
  const placeGateway = (token, phone = GUEST_PHONE, quantity = 1) =>
    call('POST', '/orders', token, {
      items: [{ productId: product.id, quantity }],
      customer: { name: 'Wallet Payer', phone },
      deliveryAddress: { line1: 'Bank Road', city: 'Mardan' },
      paymentMethod: 'jazzcash',
    });

  // =========================================================================
  section('The gateway is configured for this run');
  // =========================================================================
  const methods = (await call('GET', '/orders/payment-methods', null)).body.data ?? [];
  const gatewayOffered = methods.some((m) => m.method === 'jazzcash');
  check(
    'JazzCash is offered at checkout',
    gatewayOffered,
    'without it the whole held-stock path is untestable — see fixtures/payments.seed.js',
  );

  if (!gatewayOffered) {
    // Nothing below can run without it, and pretending otherwise would report a
    // green suite that tested none of the logic it names.
    return report();
  }

  // =========================================================================
  section('An unpaid order holds stock, but not forever');
  // =========================================================================
  const before = await stockOf();
  const placed = await placeGateway(null);
  const order = placed.body.data?.order;

  check('the order was placed', placed.status === 201 && Boolean(order?.orderNumber));
  check('it is waiting for payment', order?.paymentStatus === 'pending', `got ${order?.paymentStatus}`);
  check('the customer is handed to the gateway', Boolean(placed.body.data?.payment?.endpoint));
  check('stock was taken immediately', (await stockOf()) === before - 1);

  check(
    'the hold carries an expiry',
    Boolean(order?.reservationExpiresAt),
    'without one, an abandoned payment locks the item permanently',
  );
  check(
    'the expiry is in the future',
    new Date(order.reservationExpiresAt).getTime() > Date.now(),
    `${order?.reservationExpiresAt}`,
  );

  // =========================================================================
  section('Abandoned payments give the stock back');
  // =========================================================================
  /*
   * Let the order from the previous section finish expiring first.
   *
   * It is also an abandoned gateway order, so its stock comes back on its own
   * schedule — and if that lands in the middle of the measurement below, the
   * count moves by two and the assertion fails while the system is behaving
   * perfectly. Draining it makes the arithmetic here mean only what it says.
   */
  await waitFor(
    async () => (await call('GET', `/orders/${order.orderNumber}`, null)).body.data?.status === 'cancelled',
  );

  const heldStock = await stockOf();
  const abandoned = (await placeGateway(null)).body.data.order;
  check('placing it takes the stock', (await stockOf()) === heldStock - 1);

  const released = await waitFor(async () => {
    const current = (await call('GET', `/orders/${abandoned.orderNumber}`, null)).body.data;
    return current?.status === 'cancelled';
  });

  check('an abandoned order is eventually cancelled', released, 'the sweeper never released it');

  const afterExpiry = (await call('GET', `/orders/${abandoned.orderNumber}`, null)).body.data;
  check('its payment reads as cancelled, not paid', afterExpiry?.paymentStatus === 'cancelled');
  check(
    'the item is back on the shelf',
    (await stockOf()) === heldStock,
    `expected ${heldStock}, got ${await stockOf()}`,
  );

  // The whole point of the latch: a second sweep must not credit it again.
  const settled = await stockOf();
  await new Promise((resolve) => setTimeout(resolve, 5000));
  check(
    'a later sweep does NOT restore the stock a second time',
    (await stockOf()) === settled,
    'stock was invented out of nothing — the idempotency latch is not holding',
  );

  // =========================================================================
  section('A verified payment keeps the goods');
  // =========================================================================
  const toPay = (await placeGateway(null)).body.data.order;
  const stockWhileHeld = await stockOf();

  const paid = await call('POST', '/orders/payments/jazzcash/callback', null, callbackFor(toPay));
  check('the gateway callback is accepted', paid.status === 200 && paid.body.data?.verified === true);
  check('the order is marked paid', paid.body.data?.order?.paymentStatus === 'paid');
  check('and confirmed', paid.body.data?.order?.status === 'confirmed');
  check(
    'the expiry is cleared so the sweeper can never touch it',
    !paid.body.data?.order?.reservationExpiresAt,
  );
  check('stock stays deducted', (await stockOf()) === stockWhileHeld);

  // Gateways retry. Replaying a success must change nothing.
  const replay = await call('POST', '/orders/payments/jazzcash/callback', null, callbackFor(toPay));
  check('a replayed callback is idempotent', replay.body.data?.order?.paymentStatus === 'paid');
  check('and does not move stock again', (await stockOf()) === stockWhileHeld);

  // A paid order must survive the sweeper even once its original window passes.
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  const stillPaid = (await call('GET', `/orders/${toPay.orderNumber}`, null)).body.data;
  check(
    'a PAID order is never expired',
    stillPaid?.status === 'confirmed' && stillPaid?.paymentStatus === 'paid',
    `became ${stillPaid?.status}/${stillPaid?.paymentStatus}`,
  );

  // =========================================================================
  section('The frontend cannot declare an order paid');
  // =========================================================================
  const forgedTarget = (await placeGateway(null)).body.data.order;

  const forged = await call('POST', '/orders/payments/jazzcash/callback', null, {
    ...callbackFor(forgedTarget, { salt: 'attacker-guessed-salt' }),
  });
  check('a callback signed with the wrong key is refused', forged.body.data?.verified === false);
  check(
    'and the order is still unpaid',
    (await call('GET', `/orders/${forgedTarget.orderNumber}`, null)).body.data?.paymentStatus === 'pending',
  );

  const unsigned = await call('POST', '/orders/payments/jazzcash/callback', null, {
    ppmpf_1: forgedTarget.orderNumber,
    pp_ResponseCode: '000',
    pp_Amount: String(forgedTarget.total * 100),
  });
  check('an unsigned "I paid" is refused', unsigned.body.data?.verified === false);

  // =========================================================================
  section('A short payment is held for a human, not confirmed');
  // =========================================================================
  const shortPaid = (await placeGateway(null)).body.data.order;
  const short = await call(
    'POST',
    '/orders/payments/jazzcash/callback',
    null,
    callbackFor(shortPaid, { amount: 1 }),
  );
  check(
    'a signed callback for the wrong amount is not "paid"',
    short.body.data?.order?.paymentStatus === 'awaiting_verification',
  );
  check('nor confirmed', short.body.data?.order?.status !== 'confirmed');

  // =========================================================================
  section('A declined payment releases the hold at once');
  // =========================================================================
  const declinedOrder = (await placeGateway(null)).body.data.order;
  const heldForDecline = await stockOf();

  const declined = await call(
    'POST',
    '/orders/payments/jazzcash/callback',
    null,
    callbackFor(declinedOrder, { responseCode: '999' }),
  );
  check('the decline is verified as genuine', declined.body.data?.verified === true);
  check('the payment reads failed', declined.body.data?.order?.paymentStatus === 'failed');
  check('the stock comes straight back', (await stockOf()) === heldForDecline + 1);

  const declinedTwice = await call(
    'POST',
    '/orders/payments/jazzcash/callback',
    null,
    callbackFor(declinedOrder, { responseCode: '999' }),
  );
  check('a repeated decline is accepted', declinedTwice.status === 200);
  check(
    'but does NOT restore the stock twice',
    (await stockOf()) === heldForDecline + 1,
    'a retried decline duplicated inventory',
  );

  // =========================================================================
  section('Guest cancellation needs more than the order number');
  // =========================================================================
  const guestOrder = (
    await call('POST', '/orders', null, {
      items: [{ productId: product.id, quantity: 1 }],
      customer: { name: 'Guest Diner', phone: GUEST_PHONE },
      deliveryAddress: { line1: 'Sheikh Maltoon', city: 'Mardan' },
      paymentMethod: 'cod',
    })
  ).body.data.order;

  const tracked = (await call('GET', `/orders/${guestOrder.orderNumber}`, null)).body.data;
  check('a guest can still track by number', tracked?.orderNumber === guestOrder.orderNumber);
  check(
    'but the phone number is redacted',
    tracked?.customerPhone !== GUEST_PHONE && String(tracked?.customerPhone ?? '').endsWith('877'),
    `got ${tracked?.customerPhone} — handing it back would make the check below decorative`,
  );

  const noPhone = await call('POST', `/orders/${guestOrder.orderNumber}/cancel`, null);
  check('the order number ALONE cannot cancel it', noPhone.status === 403, `got ${noPhone.status}`);

  const wrongPhone = await call('POST', `/orders/${guestOrder.orderNumber}/cancel`, null, {
    phone: '03001112223',
  });
  check('a wrong phone number cannot cancel it', wrongPhone.status === 403);
  check(
    'and the refusal does not reveal what was wrong',
    !/phone|number does not match/i.test(wrongPhone.body.message ?? '') ||
      wrongPhone.body.message === noPhone.body.message,
    `"${wrongPhone.body.message}"`,
  );
  check(
    'the order really is untouched',
    (await call('GET', `/orders/${guestOrder.orderNumber}`, null)).body.data?.status !== 'cancelled',
  );

  const rightPhone = await call('POST', `/orders/${guestOrder.orderNumber}/cancel`, null, {
    // Spaced and dashed, as a customer would type it.
    phone: '0300-999 8877',
  });
  check('the real phone number cancels it', rightPhone.status === 200, `got ${rightPhone.status}`);
  check('even when typed with spaces and dashes', rightPhone.body.data?.status === 'cancelled');

  // =========================================================================
  section("An account's order cannot be cancelled by a stranger");
  // =========================================================================
  const mine = (
    await call('POST', '/orders', custToken, {
      items: [{ productId: product.id, quantity: 1 }],
      customer: { name: 'Paying Customer', phone: GUEST_PHONE },
      deliveryAddress: { line1: 'Bank Road', city: 'Mardan' },
      paymentMethod: 'cod',
    })
  ).body.data.order;

  const anonymous = await call('POST', `/orders/${mine.orderNumber}/cancel`, null, { phone: GUEST_PHONE });
  check(
    'an anonymous caller cannot cancel it, even with the phone',
    anonymous.status === 403,
    `got ${anonymous.status} — an account order is proved by the session, not by a number`,
  );

  const otherEmail = uniqueEmail('other');
  const otherToken = (
    await call('POST', '/auth/register', null, {
      fullName: 'Someone Else',
      email: otherEmail,
      phone: uniquePhone('0346'),
      password: PW,
    })
  ).body.data?.accessToken;

  check(
    'another signed-in customer cannot cancel it either',
    (await call('POST', `/orders/${mine.orderNumber}/cancel`, otherToken)).status === 403,
  );

  const owner = await call('POST', `/orders/${mine.orderNumber}/cancel`, custToken);
  check('the owner can, with no phone required', owner.status === 200, `got ${owner.status}`);

  const cancelledTwice = await call('POST', `/orders/${mine.orderNumber}/cancel`, custToken);
  check('cancelling twice is refused', cancelledTwice.status >= 400);

  // =========================================================================
  section('The back office still sees everything');
  // =========================================================================
  /*
   * Searched by order number rather than reading the top of the list: the demo
   * orders carry no phone number at all, so "the newest five rows" proved
   * nothing either way and passed or failed on what the seed happened to write.
   */
  const adminView = await call('GET', `/orders/admin/list?search=${guestOrder.orderNumber}`, superToken);
  const adminRow = (adminView.body.data ?? []).find((row) => row.orderNumber === guestOrder.orderNumber);
  check('staff can find the order', adminView.status === 200 && Boolean(adminRow));
  check(
    'the back office list shows the full phone number',
    adminRow?.customerPhone === GUEST_PHONE,
    `got ${adminRow?.customerPhone} — the kitchen has to be able to ring the customer`,
  );

  const staffRead = await call('GET', `/orders/${guestOrder.orderNumber}`, superToken);
  check(
    'and so does a staff read of the order itself',
    staffRead.body.data?.customerPhone === GUEST_PHONE,
    `got ${staffRead.body.data?.customerPhone}`,
  );

  return report();
}
