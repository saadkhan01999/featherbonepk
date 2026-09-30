/**
 * Preparation stations and forwarding website orders.
 *
 *   • stations: the catch-all "Kitchen" exists; categories route lines;
 *     the catch-all cannot be deleted or switched off
 *   • a website order waits on the dashboard until a person forwards it,
 *     then each station sees only its own items
 *   • the order is ready only when every station is done
 *   • till orders go straight to their stations; "auto" and "off" modes
 */
import { OWNER_EMAIL, call, login, suite } from './harness.mjs';

const categoryOf = (product) =>
  String(product.category?.id ?? product.category?._id ?? product.category ?? '');

export default async function run() {
  const { check, section, report } = suite('stations');

  const owner = await login(OWNER_EMAIL);
  const cashier = await login('cashier@featherandbone.dev');
  const kitchen = await login('kitchen@featherandbone.dev');

  await call('PATCH', '/settings/kitchen', owner, { kitchenEnabled: true, kitchenWebsiteOrders: 'review' });

  const menu = (await call('GET', '/catalog/products?limit=100', null)).body.data ?? [];
  const inStock = menu.filter((p) => p.stock > 5 && !p.isWeighed);
  const chickenItem = inStock[0];
  const chickenCategory = categoryOf(chickenItem);
  const kitchenItem = inStock.find((p) => categoryOf(p) && categoryOf(p) !== chickenCategory);

  const placeOrder = (items = [chickenItem, kitchenItem]) =>
    call('POST', '/orders', null, {
      items: items.map((p) => ({ productId: p.id, quantity: 1 })),
      customer: { name: 'Station Test', phone: '03001234567' },
      deliveryAddress: { line1: 'House 1, Street 2', city: 'Mardan' },
      paymentMethod: 'cod',
    });

  /* ------------------------------------------------------------------ */
  section('Stations');

  check(
    'two products in different categories to route',
    Boolean(chickenItem && kitchenItem && chickenCategory),
  );

  let stations = (await call('GET', '/stations', owner)).body.data ?? [];
  const catchAll = stations.find((s) => s.isDefault);
  check('there is always a catch-all station', catchAll?.name === 'Kitchen' && catchAll.isActive);
  check('a cashier cannot manage stations', (await call('GET', '/stations', cashier)).status === 403);

  const created = await call('POST', '/stations', owner, {
    name: 'Chicken Counter',
    categories: [chickenCategory],
  });
  const chicken = created.body.data;
  check(
    'the owner adds a station for a category',
    created.status === 201 && chicken?.slug === 'chicken-counter',
  );
  check(
    'a second station with the same name is refused',
    (await call('POST', '/stations', owner, { name: 'chicken counter' })).status === 409,
  );
  check(
    'an unknown category is refused',
    (await call('POST', '/stations', owner, { name: 'Bad', categories: ['0123456789abcdef01234567'] }))
      .status === 422,
  );
  check(
    'the catch-all cannot be deleted',
    (await call('DELETE', `/stations/${catchAll.id}`, owner)).status === 400,
  );
  check(
    'or switched off',
    (await call('PATCH', `/stations/${catchAll.id}`, owner, { isActive: false })).status === 400,
  );

  const mover = (
    await call('POST', '/stations', owner, { name: 'Test Grill', categories: [chickenCategory] })
  ).body.data;
  stations = (await call('GET', '/stations', owner)).body.data ?? [];
  check(
    'a category belongs to one station at a time',
    !stations.find((s) => s.id === chicken.id).categories.some((c) => c.id === chickenCategory),
  );
  await call('DELETE', `/stations/${mover.id}`, owner);
  await call('PATCH', `/stations/${chicken.id}`, owner, { categories: [chickenCategory] });

  const config = (await call('GET', '/settings/kitchen-config', kitchen)).body.data;
  check(
    'kitchen screens receive the station list',
    config?.stations?.some((s) => s.slug === 'chicken-counter') && config.kitchen.websiteOrders === 'review',
  );

  /* ------------------------------------------------------------------ */
  section('A website order waits for a person');

  const placed = (await placeOrder()).body.data?.order;
  check('it is confirmed', placed?.status === 'confirmed');
  check('but not yet a kitchen ticket', placed?.ticketNumber == null);

  const onScreen = async (orderNumber, query = '') =>
    ((await call('GET', `/kitchen/tickets${query}`, kitchen)).body.data?.tickets ?? []).find(
      (t) => t.orderNumber === orderNumber,
    );
  check('the kitchen does not see it yet', !(await onScreen(placed.orderNumber)));

  const incoming = (await call('GET', '/orders/admin/incoming', owner)).body.data;
  const waiting = incoming?.orders?.find((o) => o.orderNumber === placed.orderNumber);
  check('the dashboard lists it under Incoming', Boolean(waiting) && incoming.mode === 'review');
  check(
    'with a suggested station for each item, by category',
    waiting?.items[0]?.suggestedStation === chicken.id && waiting?.items[1]?.suggestedStation === catchAll.id,
    JSON.stringify(waiting?.items),
  );

  const bell = (await call('GET', '/notifications', owner)).body.data ?? [];
  check('the bell says there are orders to send', JSON.stringify(bell).includes('orders:to-forward'));

  const forwardUrl = `/orders/${placed.orderNumber}/forward`;
  check('a cashier cannot forward orders', (await call('POST', forwardUrl, cashier, {})).status === 403);
  check(
    'an unknown station is refused',
    (await call('POST', forwardUrl, owner, { lines: [{ index: 0, station: '0123456789abcdef01234567' }] }))
      .status === 422,
  );
  check(
    'sending nothing to any station is refused',
    (
      await call('POST', forwardUrl, owner, {
        lines: [
          { index: 0, station: null },
          { index: 1, station: null },
        ],
      })
    ).status === 400,
  );

  const forwarded = await call('POST', forwardUrl, owner, { kitchenNote: 'Extra spicy' });
  check('forwarding works', forwarded.status === 200, forwarded.body.message);
  check('it gets a ticket number', Number.isInteger(forwarded.body.data?.ticketNumber));
  check(
    'and goes to both stations',
    [...(forwarded.body.data?.stations ?? [])].sort().join(',') === 'Chicken Counter,Kitchen',
  );
  check('forwarding twice is refused', (await call('POST', forwardUrl, owner, {})).status === 409);
  check(
    'it leaves the Incoming list',
    !((await call('GET', '/orders/admin/incoming', owner)).body.data?.orders ?? []).some(
      (o) => o.orderNumber === placed.orderNumber,
    ),
  );

  /* ------------------------------------------------------------------ */
  section('Each station sees its own items');

  const chickenView = await onScreen(placed.orderNumber, '?station=chicken-counter');
  const kitchenView = await onScreen(placed.orderNumber, '?station=kitchen');
  const allView = await onScreen(placed.orderNumber);
  check(
    'the chicken counter sees only the chicken',
    chickenView?.items.length === 1 && chickenView.items[0].name === chickenItem.name,
  );
  check(
    'the kitchen sees only its dish',
    kitchenView?.items.length === 1 && kitchenView.items[0].name === kitchenItem.name,
  );
  check('the note from the back office reaches the cooks', chickenView?.kitchenNote === 'Extra spicy');
  check(
    'the all-stations view shows both, with each station',
    allView?.items.length === 2 && allView.stations.length === 2,
  );
  check(
    'an unknown station screen says so',
    (await call('GET', '/kitchen/tickets?station=no-such-station', kitchen)).status === 404,
  );

  /* ------------------------------------------------------------------ */
  section('Ready when every station is done');

  const ticketUrl = (action) => `/kitchen/tickets/${chickenView.id}/${action}`;
  check(
    'the chicken counter accepts its part',
    (await call('POST', ticketUrl('accept'), kitchen, { station: 'chicken-counter' })).status === 200,
  );
  check('the order is now preparing', (await onScreen(placed.orderNumber)).status === 'preparing');
  check(
    'accepting twice is refused',
    (await call('POST', ticketUrl('accept'), kitchen, { station: 'chicken-counter' })).status === 409,
  );

  await call('POST', ticketUrl('ready'), kitchen, { station: 'chicken-counter' });
  check(
    'the chicken is done but the order waits for the kitchen',
    (await onScreen(placed.orderNumber)).status === 'preparing' &&
      (await onScreen(placed.orderNumber, '?station=chicken-counter')).stage === 'ready' &&
      (await onScreen(placed.orderNumber, '?station=kitchen')).stage === 'new',
  );

  const kitchenDone = await call('POST', ticketUrl('ready'), kitchen, { station: 'kitchen' });
  check('the kitchen finishes', kitchenDone.status === 200, kitchenDone.body.message);
  check('now the whole order is ready', (await onScreen(placed.orderNumber)).status === 'ready');
  check(
    'finishing twice is refused',
    (await call('POST', ticketUrl('ready'), kitchen, { station: 'kitchen' })).status === 409,
  );
  await call('POST', ticketUrl('serve'), kitchen);

  /* ------------------------------------------------------------------ */
  section('Automatic and switched-off forwarding');

  await call('PATCH', '/settings/kitchen', owner, { kitchenWebsiteOrders: 'auto' });
  const auto = (await placeOrder()).body.data?.order;
  check('"auto": the order goes straight to the stations', Number.isInteger(auto?.ticketNumber));
  check(
    'each line on its own station',
    (await onScreen(auto.orderNumber, '?station=chicken-counter'))?.items.length === 1,
  );
  check(
    'a station with work in progress cannot be deleted',
    (await call('DELETE', `/stations/${chicken.id}`, owner)).status === 409,
  );
  await call('POST', `/kitchen/tickets/${(await onScreen(auto.orderNumber)).id}/ready`, kitchen, {});
  check(
    '"done" on the all-stations view finishes every station',
    (await onScreen(auto.orderNumber)).status === 'ready',
  );

  await call('PATCH', '/settings/kitchen', owner, { kitchenWebsiteOrders: 'off' });
  const off = (await placeOrder([kitchenItem])).body.data?.order;
  check('"off": the order never becomes a kitchen ticket', off?.ticketNumber == null);
  check(
    'and cannot be forwarded',
    (await call('POST', `/orders/${off.orderNumber}/forward`, owner, {})).status === 400,
  );

  await call('PATCH', '/settings/kitchen', owner, { kitchenWebsiteOrders: 'review' });
  await call('PATCH', `/orders/${off.orderNumber}/status`, owner, { status: 'cancelled' });
  await call('POST', `/kitchen/tickets/${(await onScreen(auto.orderNumber)).id}/serve`, kitchen);

  check(
    'a finished station can be deleted',
    (await call('DELETE', `/stations/${chicken.id}`, owner)).status === 200,
  );

  return report();
}
