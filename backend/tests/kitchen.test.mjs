/**
 * Kitchen Display, till tickets and live updates.
 * ---------------------------------------------------------------------------
 * The whole journey a plate takes: fired at the till (paid or unpaid), seen by
 * the kitchen, accepted, marked ready, shown on the pickup board, handed over —
 * and every screen hearing about it over the socket as it happens.
 */
import { randomUUID } from 'node:crypto';

import { io } from 'socket.io-client';

import {
  OWNER_EMAIL,
  ORIGIN,
  call,
  login,
  posLogin,
  suite,
  uniquePhone,
  uniqueEmail,
  PW,
} from './harness.mjs';

/** Resolve with the first event matching `predicate`, or null after `ms`. */
function nextEvent(socket, event, predicate = () => true, ms = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function connect(auth) {
  return new Promise((resolve) => {
    const socket = io(ORIGIN, {
      path: '/api/v1/socket.io',
      auth,
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => resolve({ socket, error: null }));
    socket.on('connect_error', (error) => resolve({ socket, error }));
  });
}

export default async function run() {
  const { check, section, report } = suite('kitchen');

  const owner = await login(OWNER_EMAIL);
  const kitchen = await login('kitchen@featherandbone.dev');

  // A till of our own, unassigned (sells everything), so other suites'
  // counters and menus cannot change what this one sees.
  const code = `TILL-K${String(Date.now()).slice(-5)}`;
  await call('POST', '/terminals', owner, { code, name: 'Kitchen Test Till' });
  const pos = (await posLogin('cashier@featherandbone.dev', code)).body.data.posToken;

  const menu = (await call('GET', '/pos/products?limit=200', pos)).body.data ?? [];
  const product = menu.find((p) => p.stock > 30 && !p.isWeighed);
  check('a sellable product exists for the test', Boolean(product));

  section('Kitchen settings are on by default and published');
  const posConfig = (await call('GET', '/settings/pos-config', pos)).body.data;
  check(
    'the till receives the kitchen settings',
    posConfig?.kitchen?.enabled === true,
    JSON.stringify(posConfig?.kitchen),
  );
  check('the till receives its receipt settings', posConfig?.pos?.receipt?.bold === true);
  const kitchenConfig = await call('GET', '/settings/kitchen-config', kitchen);
  check('the kitchen account can read its config', kitchenConfig.status === 200);
  check('and is told it is signed in', kitchenConfig.body.data?.access?.signedIn === true);

  section('Open kitchen screens — no login (the default)');
  const openConfig = await call('GET', '/settings/kitchen-config', null);
  check('the kitchen config opens without signing in', openConfig.status === 200, openConfig.body.message);
  check(
    'and says this screen may press every button',
    openConfig.body.data?.access?.open === true &&
      openConfig.body.data?.access?.signedIn === false &&
      openConfig.body.data?.access?.canManage === true,
  );
  check('the tickets open without signing in', (await call('GET', '/kitchen/tickets', null)).status === 200);
  check(
    'the order board opens without signing in',
    (await call('GET', '/kitchen/board', null)).status === 200,
  );
  const openScreen = await connect({ kind: 'kitchen' });
  check('an open kitchen screen gets a live connection', !openScreen.error, openScreen.error?.message);

  section('Kitchen screens closed in Settings — sign-in required');
  await call('PATCH', '/settings/kitchen', owner, { kitchenOpenAccess: false });
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('the open screen is disconnected at once', openScreen.socket.connected === false);
  openScreen.socket.close();
  const closedTickets = await call('GET', '/kitchen/tickets', null);
  check(
    'no login → 401, with a code the page acts on',
    closedTickets.status === 401 && closedTickets.body.code === 'KITCHEN_SIGN_IN',
  );
  const closedSocket = await connect({ kind: 'kitchen' });
  check('an unsigned kitchen socket is refused', Boolean(closedSocket.error));
  closedSocket.socket.close();
  const signedSocket = await connect({ token: kitchen, kind: 'kitchen' });
  check('a signed-in kitchen account still connects', !signedSocket.error, signedSocket.error?.message);
  signedSocket.socket.close();
  check(
    'a cashier website session cannot open the kitchen',
    (await call('GET', '/settings/kitchen-config', await login('cashier@featherandbone.dev'))).status === 403,
  );

  section('Live connection');
  const anonymous = await connect({});
  check('a guest can open a socket (public events only)', !anonymous.error, anonymous.error?.message);
  anonymous.socket.close();

  const forged = await connect({ token: 'not-a-token', kind: 'web' });
  check('a bad token is REFUSED, not downgraded to guest', Boolean(forged.error));
  check('and the refusal says to re-authenticate', forged.error?.data?.code === 'AUTH_FAILED');
  forged.socket.close();

  const live = await connect({ token: kitchen, kind: 'web' });
  check('the kitchen screen connects with its session', !live.error, live.error?.message);
  const kds = live.socket;

  const tillSocket = (await connect({ token: pos, kind: 'pos' })).socket;

  section('Pay now → straight to the kitchen');
  const heard = nextEvent(kds, 'order:changed', (e) => e.action === 'created' && e.terminalId === code);
  const paid = await call('POST', '/pos/sales', pos, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: 99999,
    orderType: 'take_away',
  });
  check('a paid sale is recorded', paid.status === 201, JSON.stringify(paid.body).slice(0, 160));
  check(
    'it carries a kitchen ticket number',
    Number.isInteger(paid.body.data?.ticketNumber),
    String(paid.body.data?.ticketNumber),
  );
  check('it is waiting for the kitchen, not completed', paid.body.data?.status === 'confirmed');
  check('and it is paid', paid.body.data?.paymentStatus === 'paid');
  const event = await heard;
  check('the kitchen screen HEARS it within seconds', Boolean(event), 'no order:changed event arrived');
  check(
    'the event carries the ticket number, not the order',
    event?.ticketNumber === paid.body.data?.ticketNumber && !('items' in (event ?? {})),
  );

  section('Send to kitchen, pay later (dine-in)');
  const stockBefore = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;
  const fired = await call('POST', '/pos/orders', pos, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 2 }],
    orderType: 'dine_in',
    tableNumber: 'T7',
    kitchenNote: 'No onions',
  });
  check('a ticket is sent unpaid', fired.status === 201, JSON.stringify(fired.body).slice(0, 160));
  check('it is unpaid', fired.body.data?.paymentStatus === 'pending');
  check('it has NO payment method yet', fired.body.data?.paymentMethod === null);
  check('the table travels with it', fired.body.data?.tableNumber === 'T7');
  check('ticket numbers count up', fired.body.data?.ticketNumber > paid.body.data?.ticketNumber);
  check(
    'stock leaves the shelf at once — the food is being cooked',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === stockBefore - 2,
  );

  const ticketId = fired.body.data.id;
  const open = (await call('GET', '/pos/orders/open', pos)).body.data ?? [];
  check(
    'the till lists it among its open tickets',
    open.some((t) => t.id === ticketId),
  );

  const board = (await call('GET', '/kitchen/tickets', kitchen)).body.data;
  const onScreen = board?.tickets?.find((t) => t.id === ticketId);
  check('the Kitchen Display shows it', Boolean(onScreen));
  check(
    "with the table and the cook's note",
    onScreen?.tableNumber === 'T7' && onScreen?.kitchenNote === 'No onions',
  );
  check('as a NEW ticket', onScreen?.stage === 'new');
  check('with the items spelled out', onScreen?.items?.[0]?.quantity === 2);

  section('Kitchen: accept → done → the pickup board');
  const tillHeard = nextEvent(
    tillSocket,
    'order:changed',
    (e) => e.id === ticketId && e.status === 'preparing',
  );
  const accepted = await call('POST', `/kitchen/tickets/${ticketId}/accept`, kitchen);
  check('the kitchen accepts it', accepted.status === 200, JSON.stringify(accepted.body).slice(0, 140));
  check('it is now preparing', accepted.body.data?.stage === 'preparing');
  check('the till hears the kitchen started it', Boolean(await tillHeard));
  check(
    'accepting twice is refused, not repeated',
    (await call('POST', `/kitchen/tickets/${ticketId}/accept`, kitchen)).status === 409,
  );

  const ready = await call('POST', `/kitchen/tickets/${ticketId}/ready`, kitchen);
  check('the kitchen marks it ready', ready.body.data?.stage === 'ready');
  check('who marked it is recorded', ready.body.data?.readyBy === 'Ahmed Ali');

  const pickup = (await call('GET', '/kitchen/board', kitchen)).body.data;
  const onBoard = pickup?.ready?.find((t) => t.id === ticketId);
  check(
    'the pickup board shows its number under Ready',
    onBoard?.ticketNumber === fired.body.data.ticketNumber,
  );
  check(
    'the board carries no names or items',
    onBoard && !('customerName' in onBoard) && !('items' in onBoard),
  );

  section('Handing over and paying the table');
  const served = await call('POST', `/pos/orders/${ticketId}/serve`, pos);
  check('the till hands it over', served.status === 200, JSON.stringify(served.body).slice(0, 140));
  check('it is completed', served.body.data?.status === 'completed');
  check('but still unpaid — the table is eating', served.body.data?.paymentStatus === 'pending');
  check(
    'so it stays on the till as an open tab',
    ((await call('GET', '/pos/orders/open', pos)).body.data ?? []).some((t) => t.id === ticketId),
  );

  const settle = await call('POST', `/pos/orders/${ticketId}/pay`, pos, { paymentMethod: 'card' });
  check('the table pays by card', settle.status === 200 && settle.body.data?.paymentStatus === 'paid');
  check(
    'paying twice returns the same slip, not a second charge',
    (await call('POST', `/pos/orders/${ticketId}/pay`, pos, { paymentMethod: 'cash', tendered: 99999 })).body
      .data?.paymentMethod === 'card',
  );
  check(
    'and the tab closes',
    !((await call('GET', '/pos/orders/open', pos)).body.data ?? []).some((t) => t.id === ticketId),
  );

  section('Voiding a mistake');
  const mistake = (
    await call('POST', '/pos/orders', pos, {
      saleRef: randomUUID(),
      items: [{ productId: product.id, quantity: 1 }],
      orderType: 'dine_in',
    })
  ).body.data;
  const beforeVoid = (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock;
  const voided = await call('POST', `/pos/orders/${mistake.id}/void`, pos);
  check('a NEW unpaid ticket can be voided by the cashier', voided.body.data?.status === 'cancelled');
  check(
    'its stock comes back',
    (await call('GET', `/catalog/products/${product.slug}`, null)).body.data.stock === beforeVoid + 1,
  );

  const cooking = (
    await call('POST', '/pos/orders', pos, {
      saleRef: randomUUID(),
      items: [{ productId: product.id, quantity: 1 }],
      orderType: 'dine_in',
    })
  ).body.data;
  await call('POST', `/kitchen/tickets/${cooking.id}/accept`, kitchen);
  const lateVoid = await call('POST', `/pos/orders/${cooking.id}/void`, pos);
  check('once cooking has started, a cashier cannot void it', lateVoid.status === 403);
  check('and is told a manager must', lateVoid.body.code === 'CANCEL_NOT_ALLOWED');

  const kitchenCancel = await call('PATCH', `/orders/${cooking.invoiceNumber}/status`, kitchen, {
    status: 'cancelled',
  });
  check('the kitchen account cannot cancel orders (order.cancel)', kitchenCancel.status === 403);
  const managerCancel = await call(
    'PATCH',
    `/orders/${cooking.invoiceNumber}/status`,
    await login('manager@featherandbone.dev'),
    { status: 'cancelled' },
  );
  check('a manager can', managerCancel.status === 200, JSON.stringify(managerCancel.body).slice(0, 140));

  section('Permissions that used to check nothing');
  const discounted = await call('POST', '/pos/sales', pos, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: 99999,
    discount: 50,
  });
  check('a cashier without pos.discount cannot give a discount', discounted.status === 403);
  check('and is told why', discounted.body.code === 'DISCOUNT_NOT_ALLOWED');

  const managerTill = (await posLogin('manager@featherandbone.dev', code)).body.data.posToken;
  const managerSale = await call('POST', '/pos/sales', managerTill, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    tendered: 99999,
    discount: 50,
  });
  check('a manager (who holds pos.discount) can', managerSale.status === 201);
  // Clamped to the subtotal when the item costs less than the discount.
  check(
    'and the discount is applied by the server',
    managerSale.body.data?.totals?.discount === Math.min(50, managerSale.body.data?.totals?.subtotal),
    JSON.stringify(managerSale.body.data?.totals),
  );

  const cashierView = (await call('GET', '/pos/sales?limit=100', pos)).body.data ?? [];
  const managerView = (await call('GET', '/pos/sales?limit=100', managerTill)).body.data ?? [];
  const managerInvoice = managerSale.body.data?.invoiceNumber;
  check(
    "without pos.view_all_sales, the cashier does NOT see a colleague's sale on the same till",
    cashierView.length > 0 && !cashierView.some((s) => s.invoiceNumber === managerInvoice),
  );
  check(
    "with it, the manager sees everyone's — including the cashier's",
    managerView.some((s) => s.invoiceNumber === managerInvoice) &&
      managerView.some((s) => s.invoiceNumber === paid.body.data.invoiceNumber),
  );

  // A kitchen display on the wall: may look, may not bump.
  const viewerEmail = uniqueEmail('kdsview');
  await call('POST', '/staff', owner, {
    fullName: 'Pass Screen',
    email: viewerEmail,
    password: PW,
    role: 'kitchen',
    phone: uniquePhone(),
    permissions: ['kitchen.view'],
  });
  const viewer = await login(viewerEmail);
  check(
    'kitchen.view alone can read the board',
    (await call('GET', '/kitchen/board', viewer)).status === 200,
  );
  check(
    'but cannot bump a ticket',
    (await call('POST', `/kitchen/tickets/${paid.body.data.id}/accept`, viewer)).status === 403,
  );

  section('Kitchen switched off');
  await call('PATCH', '/settings/kitchen', owner, { kitchenEnabled: false });
  const offFire = await call('POST', '/pos/orders', pos, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
  });
  check(
    '"send to kitchen" is refused with a reason',
    offFire.status === 400 && offFire.body.code === 'KITCHEN_DISABLED',
  );
  const offSale = await call('POST', '/pos/sales', pos, {
    saleRef: randomUUID(),
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: 'card',
  });
  check('a paid sale is completed at once, exactly as before', offSale.body.data?.status === 'completed');
  check('and gets no ticket', offSale.body.data?.ticketNumber === null);
  await call('PATCH', '/settings/kitchen', owner, { kitchenEnabled: true });

  section('Website orders reach the kitchen once forwarded');
  const online = await call('POST', '/orders', null, {
    items: [{ productId: product.id, quantity: 1 }],
    customer: { name: 'Kitchen Test', phone: '03001234567' },
    deliveryAddress: { line1: 'House 1, Street 2', city: 'Mardan' },
    paymentMethod: 'cod',
  });
  const onlineOrder = online.body.data?.order;
  check('a COD website order is confirmed', onlineOrder?.status === 'confirmed');
  check('and waits for staff instead of going straight to the kitchen', onlineOrder?.ticketNumber == null);
  const forwarded = await call('POST', `/orders/${onlineOrder.orderNumber}/forward`, owner, {});
  check('forwarding it issues a kitchen ticket', Number.isInteger(forwarded.body.data?.ticketNumber));
  const kitchenList = (await call('GET', '/kitchen/tickets?channel=online', kitchen)).body.data;
  check(
    'the kitchen sees it under Website',
    kitchenList?.tickets?.some((t) => t.orderNumber === onlineOrder.orderNumber),
  );
  const pickupAgain = (await call('GET', '/kitchen/board', kitchen)).body.data;
  check(
    'a DELIVERY never appears on the counter pickup board',
    ![...pickupAgain.preparing, ...pickupAgain.ready].some((t) => t.id === String(onlineOrder._id)),
  );

  kds.close();
  tillSocket.close();

  // Back to the shipped default for the next suite and for development.
  await call('PATCH', '/settings/kitchen', owner, { kitchenOpenAccess: true });

  // Leave the till out of service so it does not linger in other lists.
  await call(
    'PATCH',
    `/terminals/${(await call('GET', '/terminals', owner)).body.data.find((t) => t.code === code).id}/active`,
    owner,
    { isActive: false },
  );

  return report();
}
