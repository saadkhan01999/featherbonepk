/**
 * Opening hours, customer feedback, the Order Board settings tab, and the
 * About / Contact page settings.
 *
 *   • a website order outside opening hours is refused (SHOP_CLOSED) before
 *     anything happens — no stock held, no order number used
 *   • the "closed right now" switch, the last-orders cut-off, 24-hour days,
 *     and "not enforced" all behave; tills are never affected
 *   • feedback: anyone can send it, nothing is public until staff publish it
 *     (and only with the customer's consent), names are shortened, contact
 *     details never leave the back office
 */
import { API, OWNER_EMAIL, call, login, posLogin, suite } from './harness.mjs';

const everyDay = (entry) =>
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { ...entry }]));

/** Karachi weekday key and HH:MM for "now", the way the server sees it. */
function karachiNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    day: parts.weekday.toLowerCase().slice(0, 3),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default async function run() {
  const { check, section, report } = suite('hours');

  const owner = await login(OWNER_EMAIL);
  const cashierWeb = await login('cashier@featherandbone.dev');

  const menu = (await call('GET', '/catalog/products?limit=50', null)).body.data ?? [];
  const product = menu.find((p) => p.stock > 10 && !p.isWeighed) ?? menu[0];
  const order = (extra = {}) =>
    call('POST', '/orders', null, {
      items: [{ productId: product.id, quantity: 1 }],
      customer: { name: 'Hours Test', phone: '03001234567' },
      deliveryAddress: { line1: 'House 1, Street 2', city: 'Mardan' },
      paymentMethod: 'cod',
      ...extra,
    });
  const stockOf = async () =>
    (await call('GET', '/catalog/products?limit=50', null)).body.data.find((p) => p.id === product.id)?.stock;

  /* ------------------------------------------------------------------ */
  section('Opening hours: closed means no website order');

  const status = await call('GET', '/settings/ordering-status', null);
  check('the ordering status is public', status.status === 200 && 'canOrder' in (status.body.data ?? {}));
  const raw = await fetch(`${API}/settings/ordering-status`);
  check(
    'and never cached',
    /no-store/.test(raw.headers.get('cache-control') ?? ''),
    raw.headers.get('cache-control'),
  );

  check(
    'a bad time is refused',
    (
      await call('PATCH', '/settings/hours', owner, {
        openingHours: {
          ...everyDay({ open: '09:00', close: '23:00', closed: false }),
          mon: { open: '25:00', close: '23:00' },
        },
      })
    ).status === 422,
  );

  await call('PATCH', '/settings/hours', owner, {
    openingHours: everyDay({ open: '09:00', close: '23:00', closed: true }),
    hoursEnforceOnline: true,
    hoursTemporarilyClosed: false,
    hoursLastOrderMinutes: 0,
  });
  const closed = (await call('GET', '/settings/ordering-status', null)).body.data;
  check('closed every day → cannot order', closed.canOrder === false && closed.reason === 'closed');
  check('and the summary says so', closed.summary?.[0]?.hours === 'Closed', JSON.stringify(closed.summary));

  const stockBefore = await stockOf();
  const refused = await order();
  check(
    'a website order is refused',
    refused.status === 409 && refused.body.code === 'SHOP_CLOSED',
    refused.body.message,
  );
  check(
    "with the owner's words for the page",
    refused.body.details?.[0]?.title && refused.body.details?.[0]?.message,
  );
  check('and no stock was held', (await stockOf()) === stockBefore);

  const quote = await call('POST', '/orders/quote', null, {
    items: [{ productId: product.id, quantity: 1 }],
  });
  check('the checkout quote already knows it is closed', quote.body.data?.ordering?.canOrder === false);

  const pos = (await posLogin('cashier@featherandbone.dev')).body.data?.posToken;
  // An item from the till's own menu — website-only items are not sold at the counter.
  const tillItem = ((await call('GET', '/pos/products?limit=100', pos)).body.data ?? []).find(
    (p) => p.stock > 5 && !p.isWeighed,
  );
  const counterSale = await call('POST', '/pos/sales', pos, {
    saleRef: `hours-${Date.now()}`,
    items: [{ productId: tillItem.id, quantity: 1 }],
    paymentMethod: 'card',
  });
  check(
    'the tills keep selling while the website is closed',
    counterSale.status === 201,
    counterSale.body.message,
  );

  await call('PATCH', '/settings/hours', owner, { hoursEnforceOnline: false });
  check('with the rule switched off, the website takes orders again', (await order()).status === 201);

  /* ------------------------------------------------------------------ */
  section('Opening hours: open, 24 hours, closed right now, last orders');

  await call('PATCH', '/settings/hours', owner, {
    openingHours: everyDay({ open: '00:00', close: '00:00', closed: false }),
    hoursEnforceOnline: true,
  });
  const allDay = (await call('GET', '/settings/ordering-status', null)).body.data;
  check('open 24 hours → can order', allDay.canOrder === true && allDay.isOpen === true);
  check('24-hour days read as such', allDay.summary?.[0]?.hours === 'Open 24 hours');
  check('an order is accepted', (await order()).status === 201);

  await call('PATCH', '/settings/hours', owner, { hoursTemporarilyClosed: true });
  const paused = await order();
  check(
    '"closed right now" refuses orders',
    paused.status === 409 && paused.body.details?.[0]?.reason === 'temporarily-closed',
  );
  check('without inventing a reopening time', paused.body.details?.[0]?.opensAt === null);
  await call('PATCH', '/settings/hours', owner, { hoursTemporarilyClosed: false });

  const now = karachiNow();
  const closeAt = now.minutes + 20;
  if (closeAt < 24 * 60) {
    await call('PATCH', '/settings/hours', owner, {
      openingHours: {
        ...everyDay({ open: '09:00', close: '23:00', closed: true }),
        [now.day]: { open: '00:00', close: hhmm(closeAt), closed: false },
      },
      hoursLastOrderMinutes: 30,
    });
    const last = (await call('GET', '/settings/ordering-status', null)).body.data;
    check(
      'within the last-orders window → cannot order',
      last.isOpen === true && last.canOrder === false && last.reason === 'last-orders',
    );
    const late = await order();
    check(
      'and the order is refused',
      late.status === 409 && late.body.details?.[0]?.reason === 'last-orders',
    );
  } else {
    check('(last-orders case skipped: too close to midnight to set up)', true);
  }

  const publicSettings = (await call('GET', '/settings/public', null)).body.data;
  check('the website receives the hours', Array.isArray(publicSettings?.hours?.summary));

  // Leave ordering open at any hour for the suites that follow.
  await call('PATCH', '/settings/hours', owner, {
    openingHours: everyDay({ open: '09:00', close: '23:00', closed: false }),
    hoursEnforceOnline: false,
    hoursLastOrderMinutes: 0,
  });

  /* ------------------------------------------------------------------ */
  section('Customer feedback');

  const placed = (await order()).body.data?.order;
  const sent = await call('POST', '/feedback', null, {
    name: 'Ayesha Tariq Khan',
    email: 'ayesha@example.test',
    phone: '0300 1112233',
    orderNumber: placed?.orderNumber,
    rating: 5,
    aspects: { food: 5, service: 4 },
    tags: ['tasty', 'fast', 'tasty'],
    comment: 'The roast was perfect and the delivery was quick. Will order again!',
  });
  check('anyone can send feedback, no account needed', sent.status === 201, sent.body.message);
  check('a real order number is recognised', sent.body.data?.verifiedOrder === true);

  check(
    'a sixth star is refused',
    (await call('POST', '/feedback', null, { name: 'Bot', rating: 6, comment: 'x'.repeat(20) })).status ===
      422,
  );
  const starsOnly = await call('POST', '/feedback', null, { rating: 4, tags: ['friendly'] });
  check(
    'stars alone are enough - no name or comment needed',
    starsOnly.status === 201,
    starsOnly.body.message,
  );
  check(
    'an unknown tag is refused',
    (await call('POST', '/feedback', null, { rating: 4, tags: ['delicious'] })).status === 422,
  );
  check(
    'a comment over 1000 characters is refused',
    (await call('POST', '/feedback', null, { rating: 3, comment: 'x'.repeat(1001) })).status === 422,
  );
  check(
    'a bot filling the hidden field is refused',
    (
      await call('POST', '/feedback', null, {
        name: 'Spam',
        rating: 5,
        comment: 'Great food, visit my site!',
        website: 'http://spam',
      })
    ).status === 422,
  );

  const privateOne = await call('POST', '/feedback', null, {
    name: 'Private Person',
    rating: 2,
    comment: 'The naan was cold when it arrived, please check.',
    allowPublish: false,
  });
  check('private feedback is accepted too', privateOne.status === 201);

  let pub = (await call('GET', '/feedback/public', null)).body.data;
  check(
    'nothing is public before staff publish it',
    !pub.items.some((i) => i.comment.startsWith('The roast was perfect')),
  );

  check(
    'a cashier cannot read the feedback inbox',
    (await call('GET', '/feedback', cashierWeb)).status === 403,
  );
  const inbox = (await call('GET', '/feedback?status=new&limit=50', owner)).body.data ?? [];
  const mine = inbox.find((i) => i.comment.startsWith('The roast was perfect'));
  const secret = inbox.find((i) => i.comment.startsWith('The naan was cold'));
  check(
    'the owner sees it, with contact details',
    mine?.email === 'ayesha@example.test' && mine?.phone === '03001112233',
  );
  check(
    'tapped tags are kept, once each',
    JSON.stringify(mine?.tags) === '["tasty","fast"]',
    JSON.stringify(mine?.tags),
  );
  check(
    'feedback without a name reads "A customer"',
    inbox.some((i) => i.fullName === 'A customer' && i.tags.includes('friendly') && i.comment === ''),
  );
  const fbStats = (await call('GET', '/feedback/stats', owner)).body.data;
  check(
    'the owner sees what is mentioned most',
    fbStats?.topTags?.some((t) => t.tag === 'tasty' && t.label === 'Tasty food' && t.count >= 1),
    JSON.stringify(fbStats?.topTags),
  );

  const bell = (await call('GET', '/notifications', owner)).body.data ?? [];
  check('the bell announces new feedback', JSON.stringify(bell).includes('feedback:new'));

  check(
    'feedback the customer kept private cannot be published',
    (await call('PATCH', `/feedback/${secret.id}`, owner, { status: 'published' })).status === 400,
  );
  check(
    'publishing works',
    (await call('PATCH', `/feedback/${mine.id}`, owner, { status: 'published' })).status === 200,
  );
  check(
    'replying works',
    (await call('PATCH', `/feedback/${mine.id}`, owner, { reply: 'Thank you, Ayesha!' })).status === 200,
  );

  pub = (await call('GET', '/feedback/public', null)).body.data;
  const shown = pub.items.find((i) => i.id === mine.id);
  check('now it is on the website', Boolean(shown));
  check('with a shortened name', shown?.name === 'Ayesha K.', shown?.name);
  check('and the reply', shown?.reply === 'Thank you, Ayesha!');
  check('and never the email or phone', shown && !('email' in shown) && !('phone' in shown));
  check('with the tags the customer tapped', shown?.tags?.includes('tasty'));
  check('the score summary counts it', pub.summary.count >= 1 && pub.summary.average > 0);

  await call('PATCH', `/feedback/${mine.id}`, owner, { status: 'hidden' });
  pub = (await call('GET', '/feedback/public', null)).body.data;
  check('hiding takes it off the website', !pub.items.some((i) => i.id === mine.id));

  check('feedback can be deleted', (await call('DELETE', `/feedback/${secret.id}`, owner)).status === 200);
  check(
    'deleting twice says not found',
    (await call('DELETE', `/feedback/${secret.id}`, owner)).status === 404,
  );

  /* ------------------------------------------------------------------ */
  section('Order Board screen settings');

  await call('PATCH', '/settings/display', owner, { displayTitle: 'Collect here', displayVideos: [] });
  let board = (await call('GET', '/settings/kitchen-config', null)).body.data?.kitchen?.display;
  check('the board has its own settings tab', board?.title === 'Collect here');
  check(
    'with no videos it plays the homepage story video',
    board?.videos?.length === 1 && board.videos[0].title === 'Homepage story video',
    JSON.stringify(board?.videos),
  );
  await call('PATCH', '/settings/display', owner, { displayUseStoryVideo: false });
  board = (await call('GET', '/settings/kitchen-config', null)).body.data?.kitchen?.display;
  check('unless that is switched off', board?.videos?.length === 0);
  check('the video takes 80% of the board by default', board?.videoShare === 80, board?.videoShare);
  await call('PATCH', '/settings/display', owner, { displayVideoShare: '70' });
  board = (await call('GET', '/settings/kitchen-config', null)).body.data?.kitchen?.display;
  check('the owner can change the video size', board?.videoShare === 70);
  check(
    'but not to a size that leaves no room for the numbers',
    (await call('PATCH', '/settings/display', owner, { displayVideoShare: '95' })).status === 422,
  );
  await call('PATCH', '/settings/display', owner, {
    displayTitle: 'Order Status',
    displayUseStoryVideo: true,
    displayVideoShare: '80',
  });

  /* ------------------------------------------------------------------ */
  section('About and Contact pages');

  let site = (await call('GET', '/settings/public', null)).body.data;
  check('the About page has its own heading', site?.content?.aboutHeading === 'The story behind our food');
  check('and "how we work" steps to start from', site?.content?.aboutSteps?.length === 4);
  check(
    'nothing invented: no team, timeline or gallery until the owner adds them',
    site?.content?.aboutTeam?.length === 0 &&
      site?.content?.aboutTimeline?.length === 0 &&
      site?.content?.aboutGallery?.length === 0,
  );

  const aboutSaved = await call('PATCH', '/settings/about', owner, {
    aboutSince: '2019',
    aboutQuote: 'Every roast is basted by hand.',
    aboutTimeline: [{ year: '2019', title: 'Opened our first counter' }],
    aboutTeam: [{ name: 'Saad Ahmed', role: 'Head cook' }],
    aboutGallery: [{ image: '/uploads/kitchen.jpg', caption: 'Our kitchen' }],
  });
  check('the owner fills in the About page', aboutSaved.status === 200, aboutSaved.body.message);
  site = (await call('GET', '/settings/public', null)).body.data;
  check(
    'and it reaches the website',
    site?.content?.aboutSince === '2019' &&
      site?.content?.aboutTimeline?.[0]?.title === 'Opened our first counter' &&
      site?.content?.aboutTeam?.[0]?.role === 'Head cook' &&
      site?.content?.aboutGallery?.[0]?.caption === 'Our kitchen',
  );
  check(
    'a milestone needs a year',
    (await call('PATCH', '/settings/about', owner, { aboutTimeline: [{ title: 'No year' }] })).status === 422,
  );
  await call('PATCH', '/settings/about', owner, {
    aboutSince: '',
    aboutQuote: '',
    aboutTimeline: [],
    aboutTeam: [],
    aboutGallery: [],
  });

  check('the Contact banner falls back to the homepage picture', site?.contact?.image === null);
  const contactSaved = await call('PATCH', '/settings/contact', owner, {
    contactImage: '/uploads/contact-banner.jpg',
    contactBannerShade: 'dark',
    contactBannerLabel: 'Say hello',
  });
  check('the owner sets the Contact banner', contactSaved.status === 200, contactSaved.body.message);
  site = (await call('GET', '/settings/public', null)).body.data;
  check(
    'and the website shows it',
    site?.contact?.image === '/uploads/contact-banner.jpg' &&
      site?.contact?.bannerShade === 'dark' &&
      site?.contact?.bannerLabel === 'Say hello',
  );
  check(
    'a script address is refused as a banner',
    (await call('PATCH', '/settings/contact', owner, { contactImage: 'javascript:alert(1)' })).status === 422,
  );
  await call('PATCH', '/settings/contact', owner, {
    contactImage: '',
    contactBannerShade: 'medium',
    contactBannerLabel: 'Contact Us',
  });

  return report();
}
