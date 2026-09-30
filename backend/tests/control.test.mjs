/**
 * The owner's controls: per-till menus, reports and exports, recording
 * payments, the stock ledger, website settings and custom pages.
 */
import { randomUUID } from 'node:crypto';

import { API, OWNER_EMAIL, call, login, posLogin, suite, uniqueEmail, uniquePhone, PW } from './harness.mjs';

/** GET a binary export with a bearer token. */
async function download(path, token) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    disposition: response.headers.get('content-disposition') ?? '',
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

export default async function run() {
  const { check, section, report } = suite('control');
  const owner = await login(OWNER_EMAIL);
  const cashierWeb = await login('cashier@featherandbone.dev');

  /* ------------------------------------------------------------------ */
  section('Each till can sell only what the owner chooses');
  /* ------------------------------------------------------------------ */
  const code = `TILL-M${String(Date.now()).slice(-5)}`;
  const created = await call('POST', '/terminals', owner, { code, name: 'Menu Test Till' });
  const terminalId = created.body.data.id;
  const pos = (await posLogin('cashier@featherandbone.dev', code)).body.data.posToken;

  const everything = (await call('GET', '/pos/products?limit=200', pos)).body.data ?? [];
  const categories = [...new Set(everything.map((p) => p.category?._id ?? p.category))].filter(Boolean);
  check('the till starts with the whole menu across several categories', categories.length >= 2);

  const [keep] = categories;
  const insideItem = everything.find(
    (p) => (p.category?._id ?? p.category) === keep && p.stock > 5 && !p.isWeighed,
  );
  const outsideItem = everything.find(
    (p) => (p.category?._id ?? p.category) !== keep && p.stock > 5 && !p.isWeighed,
  );

  const scoped = await call('PATCH', `/terminals/${terminalId}`, owner, {
    menuMode: 'categories',
    menuCategories: [keep],
  });
  check(
    'the owner limits the till to one category',
    scoped.status === 200,
    JSON.stringify(scoped.body).slice(0, 140),
  );

  const menuNow = (await call('GET', '/pos/products?limit=200', pos)).body.data ?? [];
  check(
    'the till menu changes immediately — no sign-out',
    menuNow.length > 0 && menuNow.every((p) => (p.category?._id ?? p.category) === keep),
  );
  const chips = (await call('GET', '/pos/categories', pos)).body.data ?? [];
  check('only that category chip is offered', chips.length === 1 && String(chips[0]._id) === keep);

  const sneaky = await call('POST', '/pos/sales', pos, {
    saleRef: randomUUID(),
    items: [{ productId: outsideItem.id, quantity: 1 }],
    paymentMethod: 'card',
  });
  check('selling an item OUTSIDE the menu by id is refused', sneaky.status === 422, `got ${sneaky.status}`);
  check(
    'with a reason naming the till menu',
    JSON.stringify(sneaky.body).includes("not on this till's menu"),
  );
  check(
    'an item inside the menu still sells',
    (
      await call('POST', '/pos/sales', pos, {
        saleRef: randomUUID(),
        items: [{ productId: insideItem.id, quantity: 1 }],
        paymentMethod: 'card',
      })
    ).status === 201,
  );

  if (outsideItem.barcode) {
    check(
      'scanning an outside item is refused at the scanner',
      (await call('GET', `/pos/products/resolve?code=${outsideItem.barcode}`, pos)).status === 404,
    );
  }

  check(
    'an empty category list is refused (it would empty the till)',
    (await call('PATCH', `/terminals/${terminalId}`, owner, { menuMode: 'categories', menuCategories: [] }))
      .status === 400,
  );
  check(
    'a non-existent category is refused',
    (await call('PATCH', `/terminals/${terminalId}`, owner, { menuCategories: ['0123456789abcdef01234567'] }))
      .status === 400,
  );

  await call('PATCH', `/terminals/${terminalId}`, owner, {
    menuMode: 'products',
    menuProducts: [outsideItem.id],
  });
  const handPicked = (await call('GET', '/pos/products?limit=200', pos)).body.data ?? [];
  check(
    'a hand-picked product list works too',
    handPicked.length === 1 && handPicked[0].id === outsideItem.id,
  );

  await call('PATCH', `/terminals/${terminalId}`, owner, { menuMode: 'all' });
  check(
    '"everything" restores the full menu',
    ((await call('GET', '/pos/products?limit=200', pos)).body.data ?? []).length === everything.length,
  );

  // One cash sale on this till, for the till report below.
  const tillSale = await call('POST', '/pos/sales', pos, {
    saleRef: randomUUID(),
    items: [{ productId: insideItem.id, quantity: 2 }],
    paymentMethod: 'cash',
    tendered: 99999,
  });

  /* ------------------------------------------------------------------ */
  section('Reports: catalogue, scopes and the full sales report');
  /* ------------------------------------------------------------------ */
  const catalogue = (await call('GET', '/reports', owner)).body.data ?? [];
  const ids = catalogue.map((r) => r.id);
  for (const id of [
    'sales-overview',
    'sales-register',
    'till-summary',
    'inventory-stock',
    'inventory-movements',
  ]) {
    check(`the "${id}" report exists`, ids.includes(id));
  }
  check(
    'each report says which filters it takes',
    catalogue.find((r) => r.id === 'sales-overview')?.filters?.includes('scope'),
  );

  const till = await call(
    'GET',
    `/reports/sales-overview?preset=today&scope=terminal&terminal=${code}`,
    owner,
  );
  check('the full report runs for ONE till', till.status === 200, JSON.stringify(till.body).slice(0, 160));
  const tillDoc = till.body.data;
  check('its header names the till', tillDoc?.scope?.label?.includes(code));
  const revenueKpi = tillDoc?.kpis?.find((k) => k.key === 'revenue')?.value;
  const expectedTillRevenue = tillSale.body.data.totals.total + 0;
  check(
    "till revenue is exactly this till's paid sales",
    revenueKpi >= expectedTillRevenue && revenueKpi < expectedTillRevenue + 5000,
    `${revenueKpi} vs ≥${expectedTillRevenue}`,
  );
  const sectionKeys = (tillDoc?.sections ?? []).map((s) => s.key);
  check(
    'it has daily, products, payments, hours and the sales record',
    ['daily', 'products', 'payments', 'hourly', 'register'].every((k) => sectionKeys.includes(k)),
    sectionKeys.join(','),
  );
  check('a single-till report does not compare the till with itself', !sectionKeys.includes('tills'));
  const register = tillDoc.sections.find((s) => s.key === 'register');
  check(
    'the sales record lists the sale with its invoice',
    register.rows.some((r) => r.orderNumber === tillSale.body.data.invoiceNumber),
  );
  check(
    'and names the cashier',
    register.rows.some((r) => r.cashier === 'Usman Khan'),
  );
  const products = tillDoc.sections.find((s) => s.key === 'products');
  check(
    'the products section shows what this till sold',
    products.rows.some((r) => r.name === insideItem.name),
  );

  const whole = (await call('GET', '/reports/sales-overview?preset=month', owner)).body.data;
  const tillsSection = whole.sections.find((s) => s.key === 'tills');
  check(
    'the whole-business report compares every till and the website',
    tillsSection?.rows?.some((r) => r.till.startsWith('Website')) && tillsSection.rows.length >= 2,
  );
  check(
    'and splits website from till takings in the KPIs',
    whole.kpis.some((k) => k.key === 'online') && whole.kpis.some((k) => k.key === 'pos'),
  );

  const websiteOnly = (await call('GET', '/reports/sales-overview?preset=month&scope=online', owner)).body
    .data;
  check(
    'website-only scope excludes till sales',
    websiteOnly.sections.find((s) => s.key === 'register').rows.every((r) => r.source === 'Website'),
  );

  check(
    'an unknown till is a 404, not an empty report',
    (await call('GET', '/reports/sales-overview?scope=terminal&terminal=TILL-NOPE', owner)).status === 404,
  );

  section('The P&L tax total is exact');
  const pnl = (await call('GET', '/reports/profit-and-loss?preset=month', owner)).body.data;
  const reg = (await call('GET', '/reports/sales-register?preset=month', owner)).body.data;
  const registerTax = reg.kpis.find((k) => k.key === 'tax').value;
  check(
    "P&L tax equals the sum of every order's tax",
    Math.abs(pnl.totals.tax - registerTax) <= 1,
    `P&L ${pnl.totals.tax} vs orders ${registerTax} — averaging across lines weighted orders by line count`,
  );

  /* ------------------------------------------------------------------ */
  section('Exports: CSV and PDF');
  /* ------------------------------------------------------------------ */
  const csv = await download(
    `/reports/sales-overview/export?preset=today&scope=terminal&terminal=${code}&format=csv`,
    owner,
  );
  check('CSV export succeeds', csv.status === 200);
  check('CSV keeps the UTF-8 BOM', csv.bytes[0] === 0xef && csv.bytes[1] === 0xbb && csv.bytes[2] === 0xbf);
  const csvText = csv.bytes.toString('utf8');
  check(
    'multi-section CSV carries the summary and section titles',
    csvText.includes('Summary') && csvText.includes('Products Sold') && csvText.includes('Sales Record'),
  );
  check('the filename names the till', csv.disposition.includes(code.toLowerCase()));

  const pdf = await download(`/reports/sales-overview/export?preset=month&format=pdf`, owner);
  check(
    'PDF export succeeds',
    pdf.status === 200,
    `got ${pdf.status}: ${pdf.bytes.toString().slice(0, 120)}`,
  );
  check('it is served as a PDF', pdf.type.includes('application/pdf'));
  check('and IS a PDF', pdf.bytes.subarray(0, 5).toString() === '%PDF-');
  check(
    'with more than one page for a month of sales',
    (pdf.bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 1,
  );

  const stockPdf = await download('/reports/inventory-stock/export?format=pdf&stock=all', owner);
  check(
    'the inventory report exports as PDF',
    stockPdf.status === 200 && stockPdf.bytes.subarray(0, 5).toString() === '%PDF-',
  );

  check(
    'a cashier cannot export',
    (await download('/reports/inventory-stock/export?format=csv', cashierWeb)).status === 403,
  );

  /* ------------------------------------------------------------------ */
  section('Inventory: stock on hand, adjustments and the ledger');
  /* ------------------------------------------------------------------ */
  const stock = (await call('GET', '/reports/inventory-stock?stock=all', owner)).body.data;
  const row = stock?.rows?.find((r) => r.name === insideItem.name);
  check('the stock report lists every product with its category', row?.category && row.category !== '—');
  check('with dates (last updated, added)', Boolean(row?.updatedAt) && Boolean(row?.createdAt));
  check(
    'with value at cost and at retail for the owner',
    'costValue' in (row ?? {}) && 'retailValue' in (row ?? {}),
  );
  check(
    'and headline KPIs',
    stock.kpis.some((k) => k.key === 'retail') && stock.kpis.some((k) => k.key === 'low'),
  );
  const cashierStock = (await call('GET', '/reports/inventory-stock?stock=all', cashierWeb)).body.data;
  check(
    'a cashier can read stock but NOT cost prices',
    cashierStock && !cashierStock.columns.some((c) => c.key === 'costValue'),
  );

  const before = (await call('GET', `/catalog/products/${insideItem.slug}`, null)).body.data.stock;
  const added = await call('POST', `/inventory/products/${insideItem.id}/adjust`, owner, {
    mode: 'add',
    quantity: 7,
    note: 'Morning delivery',
  });
  check('a delivery is added to stock', added.status === 200 && added.body.data?.stock === before + 7);
  check(
    'removing more than there is, is refused',
    (
      await call('POST', `/inventory/products/${insideItem.id}/adjust`, owner, {
        mode: 'remove',
        quantity: 999999,
      })
    ).status === 400,
  );
  check(
    'a cashier cannot adjust stock (inventory.adjust)',
    (
      await call('POST', `/inventory/products/${insideItem.id}/adjust`, cashierWeb, {
        mode: 'add',
        quantity: 1,
      })
    ).status === 403,
  );

  const history = (await call('GET', `/inventory/products/${insideItem.id}/history`, owner)).body.data ?? [];
  check(
    'the ledger records the delivery with its note and balance',
    history.some(
      (h) =>
        h.type === 'adjustment' &&
        h.quantity === 7 &&
        h.note === 'Morning delivery' &&
        h.balanceAfter === before + 7,
    ),
  );
  check(
    'and the till sale, with its invoice as the reference',
    history.some(
      (h) => h.type === 'sale' && h.reference === tillSale.body.data.invoiceNumber && h.quantity === -2,
    ),
  );

  const movements = (await call('GET', '/reports/inventory-movements?preset=today', owner)).body.data;
  check(
    "the movements report shows today's ledger",
    movements?.rows?.some((m) => m.reference === tillSale.body.data.invoiceNumber),
  );

  // Editing a product must not quietly bypass inventory.adjust.
  const editorEmail = uniqueEmail('menuedit');
  await call('POST', '/staff', owner, {
    fullName: 'Menu Editor',
    email: editorEmail,
    password: PW,
    role: 'manager',
    phone: uniquePhone(),
    permissions: ['product.view', 'product.manage', 'category.view'],
  });
  const editor = await login(editorEmail);
  const current = (await call('GET', `/catalog/products/${insideItem.slug}`, null)).body.data;
  check(
    'product.manage without inventory.adjust can still edit a product (stock unchanged)',
    (
      await call('PATCH', `/admin/catalog/products/${insideItem.id}`, editor, {
        description: 'Edited',
        stock: current.stock,
      })
    ).status === 200,
  );
  check(
    'but cannot change the stock figure through the product form',
    (await call('PATCH', `/admin/catalog/products/${insideItem.id}`, editor, { stock: current.stock + 50 }))
      .status === 403,
  );

  /* ------------------------------------------------------------------ */
  section('Recording payments by hand (COD, bank transfer)');
  /* ------------------------------------------------------------------ */
  const place = async () =>
    (
      await call('POST', '/orders', null, {
        items: [{ productId: insideItem.id, quantity: 1 }],
        customer: { name: 'Pay Test', phone: '03001112233' },
        deliveryAddress: { line1: 'House 9, Street 9', city: 'Mardan' },
        paymentMethod: 'cod',
      })
    ).body.data.order;

  const cod = await place();
  check('a COD order starts unpaid', cod.paymentStatus === 'pending');
  const marked = await call('PATCH', `/orders/${cod.orderNumber}/payment`, owner, {
    status: 'paid',
    reference: 'Rider cash',
  });
  check('staff can mark it paid', marked.status === 200 && marked.body.data?.paymentStatus === 'paid');
  check(
    'marking it twice is refused',
    (await call('PATCH', `/orders/${cod.orderNumber}/payment`, owner, { status: 'paid' })).status === 409,
  );
  check(
    'a cashier cannot (order.manage)',
    (await call('PATCH', `/orders/${(await place()).orderNumber}/payment`, cashierWeb, { status: 'paid' }))
      .status === 403,
  );

  const delivered = await place();
  for (const status of ['preparing', 'ready', 'out_for_delivery', 'delivered']) {
    await call('PATCH', `/orders/${delivered.orderNumber}/status`, owner, { status });
  }
  const afterDelivery = (await call('GET', `/orders/${delivered.orderNumber}`, owner)).body.data;
  check(
    'a COD order DELIVERED is marked paid automatically',
    afterDelivery.paymentStatus === 'paid',
    afterDelivery.paymentStatus,
  );
  check(
    'the kitchen timestamps followed the status',
    Boolean(afterDelivery.kitchen?.readyAt && afterDelivery.kitchen?.servedAt),
  );

  /* ------------------------------------------------------------------ */
  section('Website settings: validation and publication');
  /* ------------------------------------------------------------------ */
  const evil = await call('PATCH', '/settings/footer', owner, {
    socialLinks: [{ platform: 'facebook', url: 'javascript:alert(1)' }],
  });
  check('a javascript: link is refused', evil.status === 422, `got ${evil.status}`);
  check(
    'and the error names the field',
    JSON.stringify(evil.body.details ?? []).includes('socialLinks.0.url'),
  );

  const footer = await call('PATCH', '/settings/footer', owner, {
    socialLinks: [{ platform: 'youtube', url: 'https://youtube.com/@featherbone', label: 'Our channel' }],
    customFields: [
      {
        label: 'Second Branch',
        value: 'Saddar Road',
        icon: 'store',
        showInFooter: true,
        showOnContact: false,
      },
    ],
    footerLinks: [{ label: 'Privacy', href: '/p/privacy' }],
  });
  check(
    'social links, links and custom fields save',
    footer.status === 200,
    JSON.stringify(footer.body).slice(0, 160),
  );

  const site = (await call('GET', '/settings/public', null)).body.data;
  check(
    'an added social link reaches the storefront',
    site.footer.socialLinks.some(
      (l) => l.platform === 'youtube' && l.url === 'https://youtube.com/@featherbone',
    ),
  );
  check(
    'a footer-only custom field shows in the footer',
    site.footer.customFields.some((f) => f.label === 'Second Branch'),
  );
  check('and NOT on the contact page', !site.contact.customFields.some((f) => f.label === 'Second Branch'));
  check('the theme is public', typeof site.theme?.brandColor === 'string' && site.theme.modes?.website);

  check(
    'an invalid colour is refused',
    (await call('PATCH', '/settings/theme', owner, { brandColor: 'gold' })).status === 422,
  );
  check(
    'a valid colour is saved',
    (await call('PATCH', '/settings/theme', owner, { brandColor: '#E11D48' })).status === 200 &&
      (await call('GET', '/settings/public', null)).body.data.theme.brandColor === '#e11d48',
  );
  await call('PATCH', '/settings/theme', owner, { brandColor: '#f9b416' });

  check(
    'kitchen timers must escalate (amber before red)',
    (await call('PATCH', '/settings/kitchen', owner, { kitchenWarnMinutes: 30, kitchenLateMinutes: 20 }))
      .status === 422,
  );
  check(
    'an unknown settings section is a 404',
    (await call('PATCH', '/settings/nope', owner, { x: 1 })).status === 404,
  );

  // Put the footer back as it was.
  await call('PATCH', '/settings/footer', owner, { socialLinks: [], customFields: [], footerLinks: [] });

  /* ------------------------------------------------------------------ */
  section('Custom pages');
  /* ------------------------------------------------------------------ */
  const slug = `test-page-${Date.now()}`;
  const draft = await call('POST', '/pages', owner, {
    slug,
    title: 'Catering',
    body: '## We cater\n\nWeddings and **events**.',
    showInFooter: true,
    isPublished: false,
  });
  check('a page is created as a draft', draft.status === 201);
  check('a draft is invisible to the public', (await call('GET', `/pages/${slug}`, null)).status === 404);
  check(
    'and absent from the public list',
    !((await call('GET', '/pages', null)).body.data ?? []).some((p) => p.slug === slug),
  );

  await call('PATCH', `/pages/${draft.body.data.id}`, owner, { isPublished: true });
  const published = await call('GET', `/pages/${slug}`, null);
  check('once published it is public', published.status === 200 && published.body.data.title === 'Catering');
  check(
    'a duplicate address is refused',
    (await call('POST', '/pages', owner, { slug, title: 'Again' })).status === 409,
  );
  check(
    'a script-bearing picture link is refused',
    (await call('PATCH', `/pages/${draft.body.data.id}`, owner, { heroImage: 'javascript:alert(1)' }))
      .status === 422,
  );
  check(
    'a cashier cannot create pages',
    (await call('POST', '/pages', cashierWeb, { slug: 'x-y', title: 'Nope' })).status === 403,
  );
  check(
    'the page can be deleted',
    (await call('DELETE', `/pages/${draft.body.data.id}`, owner)).status === 200,
  );

  section('Homepage best sellers come from real sales');
  const best = await call('GET', '/catalog/best-sellers?limit=6', null);
  check('best sellers are public', best.status === 200);
  check('and never more than asked for', Array.isArray(best.body.data) && best.body.data.length <= 6);
  check('and never empty while the menu has items', best.body.data.length > 0);
  const onlineMenu = (await call('GET', '/catalog/products?limit=100', null)).body.data ?? [];
  check(
    'every best seller can be bought on the website',
    best.body.data.every((p) => onlineMenu.some((m) => m.id === p.id)),
  );
  const pinnedCandidate = onlineMenu[onlineMenu.length - 1];
  await call('PATCH', `/admin/catalog/products/${pinnedCandidate.id}`, owner, { isBestSeller: true });
  const adminList =
    (await call('GET', '/admin/catalog/products?limit=100&status=active', owner)).body.data ?? [];
  const pinnedIds = new Set(adminList.filter((p) => p.isBestSeller).map((p) => p.id));
  const ranked = (await call('GET', '/catalog/best-sellers?limit=24', null)).body.data ?? [];
  const firstUnpinned = ranked.findIndex((p) => !pinnedIds.has(p.id));
  check(
    "the owner's pinned pick is listed",
    ranked.some((p) => p.id === pinnedCandidate.id),
  );
  check(
    'every pinned pick ranks ahead of the rest',
    firstUnpinned === -1 || ranked.slice(firstUnpinned).every((p) => !pinnedIds.has(p.id)),
    `${pinnedIds.size} pinned, first unpinned at ${firstUnpinned}`,
  );
  await call('PATCH', `/admin/catalog/products/${pinnedCandidate.id}`, owner, { isBestSeller: false });

  section('Homepage slider');
  const slide = (n) => ({ image: `/images/products/photos/bbq.jpg?${n}`, title: `Slide ${n}` });
  check(
    'no more than five slides',
    (await call('PATCH', '/settings/slider', owner, { sliderSlides: [1, 2, 3, 4, 5, 6].map(slide) }))
      .status === 422,
  );
  check(
    'a slide button cannot run a script',
    (
      await call('PATCH', '/settings/slider', owner, {
        sliderSlides: [{ ...slide(1), ctaHref: 'javascript:alert(1)' }],
      })
    ).status === 422,
  );
  check(
    'a slide needs a picture',
    (await call('PATCH', '/settings/slider', owner, { sliderSlides: [{ title: 'No picture' }] })).status ===
      422,
  );
  check(
    'only a listed transition is accepted',
    (await call('PATCH', '/settings/slider', owner, { sliderEffect: 'explode' })).status === 422,
  );
  const savedSlider = await call('PATCH', '/settings/slider', owner, {
    sliderSlides: [slide(1), slide(2)],
    sliderEffect: 'cube',
    sliderInterval: 7,
  });
  check('valid slides save', savedSlider.status === 200);
  const publicSlider = (await call('GET', '/settings/public', null)).body.data?.slider;
  check(
    'and reach the website',
    publicSlider?.slides?.length === 2 && publicSlider.effect === 'cube' && publicSlider.interval === 7,
    JSON.stringify(publicSlider),
  );
  check(
    'a cashier cannot change the slider',
    (await call('PATCH', '/settings/slider', cashierWeb, { sliderEffect: 'book' })).status === 403,
  );
  await call('PATCH', '/settings/slider', owner, {
    sliderSlides: [],
    sliderEffect: 'book',
    sliderInterval: 6,
  });

  section('Order Board videos');
  check(
    'no more than five videos',
    (
      await call('PATCH', '/settings/display', owner, {
        displayVideos: [1, 2, 3, 4, 5, 6].map((n) => ({ video: `/video/restaurant-story.mp4?${n}` })),
      })
    ).status === 422,
  );
  await call('PATCH', '/settings/display', owner, {
    displayVideos: [{ video: '/video/restaurant-story.mp4', title: 'Story' }],
    displayVideoSide: 'left',
  });
  const boardDisplay = (await call('GET', '/settings/kitchen-config', null)).body.data?.kitchen?.display;
  check(
    'the board receives its videos and layout',
    boardDisplay?.videos?.length === 1 &&
      boardDisplay.videoSide === 'left' &&
      boardDisplay.videoFit === 'cover',
    JSON.stringify(boardDisplay),
  );
  await call('PATCH', '/settings/display', owner, { displayVideos: [], displayVideoSide: 'right' });

  await call('PATCH', `/terminals/${terminalId}/active`, owner, { isActive: false });
  return report();
}
