/**
 * Checkout, orders and reviews — the money path on the customer side.
 */
import { OWNER_EMAIL, call, login, suite, PW, uniqueEmail, uniquePhone } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('commerce');

  const superToken = await login(OWNER_EMAIL);
  const email = uniqueEmail('shopper');
  const custToken = (
    await call('POST', '/auth/register', null, {
      fullName: 'Shopper Tester',
      email,
      phone: uniquePhone('0371'),
      password: PW,
    })
  ).body.data?.accessToken;

  const menu = await call('GET', '/catalog/products?limit=50', null);
  const product = (menu.body.data ?? []).find((p) => p.stock > 5 && !p.isWeighed);
  const other = (menu.body.data ?? []).find((p) => p.id !== product.id && p.stock > 2);

  const order = (items, extra = {}) =>
    call('POST', '/orders', custToken, {
      items,
      customer: { name: 'Shopper Tester', phone: '03001234567' },
      deliveryAddress: { line1: 'Chota Chowk', area: 'Mardan', city: 'Mardan' },
      paymentMethod: 'cod',
      ...extra,
    });

  section('Server prices the cart');
  const quote = await call('POST', '/orders/quote', null, {
    items: [{ productId: product.id, quantity: 2 }],
  });
  check('quote returned', quote.status === 200);
  check(
    'subtotal comes from the DATABASE price',
    quote.body.data.subtotal === product.effectivePrice * 2,
    `${quote.body.data.subtotal} vs ${product.effectivePrice * 2}`,
  );
  check(
    'tax follows the configured rate',
    quote.body.data.tax === Math.round(quote.body.data.subtotal * quote.body.data.taxRate),
  );

  section('Client-supplied money is ignored');
  const tampered = await call('POST', '/orders', custToken, {
    items: [{ productId: product.id, quantity: 1, price: 1, unitPrice: 1 }],
    customer: { name: 'Tamperer', phone: '03001234567' },
    deliveryAddress: { line1: 'Chota Chowk', city: 'Mardan' },
    paymentMethod: 'cod',
    total: 1,
    subtotal: 1,
    tax: 0,
  });
  check(
    'an injected total is ignored',
    tampered.body.data?.order?.total !== 1,
    `order total came back as ${tampered.body.data?.order?.total}`,
  );
  check('the real price is charged', tampered.body.data?.order?.subtotal === product.effectivePrice);

  section('Stock');
  const before = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;
  const placed = await order([{ productId: product.id, quantity: 2 }]);
  const orderNumber = placed.body.data?.order?.orderNumber;
  check('order placed', placed.status === 201 && Boolean(orderNumber));

  const afterOrder = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;
  check('stock decremented', afterOrder === before - 2, `${before} -> ${afterOrder}`);

  const oversell = await order([{ productId: product.id, quantity: 999999 }]);
  check('cannot buy more than exists', oversell.status >= 400, `got ${oversell.status}`);
  check(
    'the failed order left stock alone',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === afterOrder,
  );

  section('Order numbers are not enumerable');
  const second = await order([{ productId: other.id, quantity: 1 }]);
  const n1 = orderNumber;
  const n2 = second.body.data?.order?.orderNumber;
  check(
    'consecutive orders are not sequential',
    n1 !== n2 && !isConsecutive(n1, n2),
    `${n1} then ${n2} — a guessable number lets anyone read other people's orders`,
  );

  section('Order ownership');
  const otherEmail = uniqueEmail('nosy');
  const nosy = (
    await call('POST', '/auth/register', null, {
      fullName: 'Nosy Parker',
      email: otherEmail,
      phone: uniquePhone('0372'),
      password: PW,
    })
  ).body.data?.accessToken;
  check(
    "another customer cannot read someone else's order",
    (await call('GET', `/orders/${orderNumber}`, nosy)).status === 403,
  );
  check('the owner can read it', (await call('GET', `/orders/${orderNumber}`, custToken)).status === 200);

  section('Cancellation returns stock');
  const stockNow = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;
  const cancelled = await call('POST', `/orders/${orderNumber}/cancel`, custToken);
  check('customer can cancel an early order', cancelled.status === 200, `got ${cancelled.status}`);
  check(
    'the items go back on the shelf',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === stockNow + 2,
  );

  section('Reviews require a real purchase');
  const reviewOrder = await order([{ productId: product.id, quantity: 1 }]);
  const reviewNumber = reviewOrder.body.data.order.orderNumber;

  check(
    'cannot review before delivery',
    (
      await call('POST', '/reviews', custToken, {
        productId: product.id,
        orderNumber: reviewNumber,
        rating: 5,
      })
    ).status === 400,
  );

  // Walk it to delivered.
  const WALK = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
  let current = (await call('GET', `/orders/${reviewNumber}`, custToken)).body.data.status;
  for (const status of WALK.slice(WALK.indexOf(current) + 1)) {
    await call('PATCH', `/orders/${reviewNumber}/status`, superToken, { status });
    current = status;
  }

  check(
    'cannot review an item that was not in the order',
    (
      await call('POST', '/reviews', custToken, {
        productId: other.id,
        orderNumber: reviewNumber,
        rating: 5,
      })
    ).status === 400,
  );

  check(
    "cannot review someone else's order",
    (
      await call('POST', '/reviews', nosy, {
        productId: product.id,
        orderNumber: reviewNumber,
        rating: 1,
      })
    ).status === 404,
  );

  const review = await call('POST', '/reviews', custToken, {
    productId: product.id,
    orderNumber: reviewNumber,
    rating: 5,
    comment: 'Excellent.',
  });
  check('a verified buyer can review', review.status === 201, JSON.stringify(review.body).slice(0, 140));
  check('it starts PENDING, not published', review.body.data?.status === 'pending');

  check(
    'one review per item per order',
    (
      await call('POST', '/reviews', custToken, {
        productId: product.id,
        orderNumber: reviewNumber,
        rating: 1,
      })
    ).status === 409,
  );

  section('Moderation controls what the storefront shows');
  const publicBefore = await call('GET', `/reviews/product/${product.id}`, null);
  check(
    'pending reviews are hidden from the storefront',
    !publicBefore.body.data.items.some((r) => r.comment === 'Excellent.'),
  );

  check(
    'a customer cannot moderate',
    (
      await call('PATCH', `/reviews/${review.body.data.id}/moderate`, custToken, {
        status: 'approved',
      })
    ).status === 403,
  );

  const countBefore = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.ratingCount;
  await call('PATCH', `/reviews/${review.body.data.id}/moderate`, superToken, { status: 'approved' });

  const publicAfter = await call('GET', `/reviews/product/${product.id}`, null);
  check(
    'approved reviews appear',
    publicAfter.body.data.items.some((r) => r.comment === 'Excellent.'),
  );
  check(
    'the star breakdown counts it',
    publicAfter.body.data.breakdown.find((b) => b.stars === 5)?.count >= 1,
    'aggregate does not cast string ids — this bar silently read zero once',
  );
  check(
    'the product rating is recomputed',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.ratingCount === countBefore + 1,
  );

  await call('PATCH', `/reviews/${review.body.data.id}/moderate`, superToken, { status: 'rejected' });
  check(
    'rejecting removes it again and rolls the rating back',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.ratingCount === countBefore,
  );

  return report();
}

/**
 * Are two order numbers adjacent in a sequence?
 *
 * Compare only the suffix. Order numbers are `FB-<YYYYMMDD>-<4 base36>`, and
 * the previous version stripped every non-digit from the whole string — so it
 * glued the shared date to whatever digits happened to fall in the random part.
 * `FB-20260810-7SGY` became 202608107 and `FB-20260810-LH6B` became 202608106,
 * which differ by one, and a correct pair of random numbers was reported as an
 * enumerable sequence.
 *
 * That is a flake with teeth: it fires whenever both suffixes contain a single
 * digit one apart, and it accuses the product of a security defect it does not
 * have — the kind of red failure that gets muted rather than read.
 *
 * Base 36, because the suffix is alphanumeric: a counter rendered as base36
 * ("...8, 9, A, B") is just as enumerable as a decimal one, and comparing
 * decimal digits alone would miss it.
 */
function isConsecutive(a = '', b = '') {
  const suffix = (value) => value.split('-').at(-1) ?? '';
  const na = Number.parseInt(suffix(a), 36);
  const nb = Number.parseInt(suffix(b), 36);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) === 1;
}
