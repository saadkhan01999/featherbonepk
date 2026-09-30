/**
 * Owner-editable storefront content.
 *
 * The point of this suite: an operation the super admin performs in the back
 * office must show up on the public storefront, and must still be there on the
 * next request. Anything that only lives in React state disappears on refresh,
 * which is the failure this file exists to catch.
 */
import { API, ORIGIN, OWNER_EMAIL, call, login, suite } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('content');

  const superToken = await login(OWNER_EMAIL);

  section('Hero slides come from the database');
  const hero = await call('GET', '/promotions?placement=hero', null);
  check('hero endpoint is public', hero.status === 200);
  check('seeded hero slides are served', hero.body.data.length >= 3, String(hero.body.data.length));
  check(
    'each slide carries its own CTA',
    hero.body.data.every((s) => Boolean(s.ctaLabel)),
  );

  const offers = await call('GET', '/promotions?placement=offers', null);
  check(
    'offers are a SEPARATE surface',
    !offers.body.data.some((o) => hero.body.data.some((h) => h.id === o.id)),
    'a hero slide must not leak onto the offers page and vice versa',
  );

  section('An owner edit reaches the storefront');
  const slide = hero.body.data[0];
  const newTitle = `Edited ${Date.now()}`;

  const edited = await call('PATCH', `/promotions/${slide.id}`, superToken, { title: newTitle });
  check('super admin can edit a hero slide', edited.status === 200, `got ${edited.status}`);

  const reread = await call('GET', '/promotions?placement=hero', null);
  check(
    'the change is visible on the PUBLIC endpoint immediately',
    reread.body.data.some((s) => s.title === newTitle),
  );

  // The real question: is it persisted, or only in someone's memory?
  const rereadAgain = await call('GET', '/promotions?placement=hero', null);
  check(
    'and it PERSISTS across a fresh request',
    rereadAgain.body.data.some((s) => s.title === newTitle),
    'this is what "survives a browser refresh" means server-side',
  );

  section('Adding a slide');
  const created = await call('POST', '/promotions', superToken, {
    placement: 'hero',
    kicker: 'Test Kicker',
    title: `New Slide ${Date.now()}`,
    highlight: 'Test CTA',
    body: 'Added by the content test.',
    type: 'seasonal',
    image: '/images/products/photos/bbq.jpg',
    ctaLabel: 'Test Now',
    ctaHref: '/menu',
    displayOrder: 99,
  });
  check('a new hero slide can be added', created.status === 201, JSON.stringify(created.body).slice(0, 140));

  const withNew = await call('GET', '/promotions?placement=hero', null);
  check(
    'it appears on the storefront',
    withNew.body.data.some((s) => s.id === created.body.data.id),
  );
  check(
    'display order is respected',
    withNew.body.data[withNew.body.data.length - 1].id === created.body.data.id,
    'displayOrder 99 should sort last',
  );

  section('Pausing removes it, without deleting it');
  await call('PATCH', `/promotions/${created.body.data.id}`, superToken, { isActive: false });
  check(
    'a paused slide leaves the storefront',
    !(await call('GET', '/promotions?placement=hero', null)).body.data.some(
      (s) => s.id === created.body.data.id,
    ),
  );
  check(
    'but is still in the back office',
    (await call('GET', '/promotions/admin?placement=hero', superToken)).body.data.some(
      (s) => s.id === created.body.data.id,
    ),
  );

  section('Deleting');
  check(
    'it can be deleted',
    (await call('DELETE', `/promotions/${created.body.data.id}`, superToken)).status === 200,
  );
  check(
    'and is gone from the back office too',
    !(await call('GET', '/promotions/admin?placement=hero', superToken)).body.data.some(
      (s) => s.id === created.body.data.id,
    ),
  );

  section('Settings drive the rest of the homepage');
  const publicSettings = await call('GET', '/settings/public', null);
  check('public settings load without a token', publicSettings.status === 200);
  check('hero fallback copy is present', Boolean(publicSettings.body.data.content?.heroTitle));
  check('story video is configurable', Boolean(publicSettings.body.data.content?.storyVideoUrl));
  check(
    'NO secrets leak through the public endpoint',
    !JSON.stringify(publicSettings.body).match(/secret|password|apiKey|merchant/i),
    'this endpoint is unauthenticated',
  );

  const heading = `Story ${Date.now()}`;
  const savedSetting = await call('PATCH', '/settings/content', superToken, {
    storyHeading: heading,
  });
  check('super admin can edit site copy', savedSetting.status === 200, `got ${savedSetting.status}`);
  check(
    'the storefront sees it on the next request',
    (await call('GET', '/settings/public', null)).body.data.content.storyHeading === heading,
  );

  section('Tax rate is owner-configurable and reaches the till');
  const before = (await call('GET', '/settings/public', null)).body.data.pricing?.taxRate;
  check('a tax rate is published for the till', typeof before === 'number', String(before));

  const changed = await call('PATCH', '/settings/tax', superToken, { taxRate: 0.1 });
  check('the rate can be changed', changed.status === 200, JSON.stringify(changed.body).slice(0, 140));

  const quote = await call('POST', '/orders/quote', null, {
    items: [
      { productId: (await call('GET', '/catalog/products?limit=1', null)).body.data[0].id, quantity: 1 },
    ],
  });
  check(
    'a new quote uses the NEW rate',
    quote.body.data.taxRate === 0.1,
    `${quote.body.data.taxRate} — the GST rate must not be baked into the code`,
  );

  // Restore so later suites and the dev database are unsurprising.
  await call('PATCH', '/settings/tax', superToken, { taxRate: before });
  check('restored', (await call('GET', '/settings/public', null)).body.data.pricing.taxRate === before);

  /* ------------------------------------------------------------------
   * Regressions — every check below is a bug that shipped.
   * ------------------------------------------------------------------ */

  section('A banner can be aimed at the homepage hero');
  /*
   * The admin form had no `placement` field, so every campaign created through
   * the UI defaulted to the offers page and nothing could reach the homepage.
   * The owner made a banner, looked at the home page, saw no change, and
   * reasonably reported it as broken.
   */
  const madeHero = await call('POST', '/promotions', superToken, {
    kicker: 'REG',
    title: `Hero regression ${Date.now()}`,
    highlight: '50% OFF',
    type: 'combo',
    placement: 'hero',
    image: '/uploads/regression.jpg',
  });
  check('a hero banner can be created', madeHero.status === 201, JSON.stringify(madeHero.body).slice(0, 140));
  check(
    'the API echoes its placement back',
    madeHero.body.data?.placement === 'hero',
    'without this the admin list cannot show where a campaign appears',
  );

  const heroFeed = await call('GET', '/promotions?placement=hero', null);
  check(
    'it appears on the homepage feed',
    heroFeed.body.data.some((b) => b.id === madeHero.body.data.id),
  );

  const offersFeed = await call('GET', '/promotions?placement=offers', null);
  check(
    'and NOT on the offers page',
    !offersFeed.body.data.some((b) => b.id === madeHero.body.data.id),
    'the two surfaces must stay separate',
  );

  await call('DELETE', `/promotions/${madeHero.body.data.id}`, superToken);

  section('Story video survives the round trip');
  /*
   * The storefront rendered `content.storyVideoUrl` directly into <video src>.
   * An uploaded path is relative to the API, which is a different origin from
   * the website, so the browser 404d and showed a black rectangle. This checks
   * the value at least survives storage; mediaUrl() handles resolution.
   */
  const clip = `/uploads/2026-08/regression-${Date.now()}.mp4`;
  const savedVideo = await call('PATCH', '/settings/content', superToken, { storyVideoUrl: clip });
  check('a video path can be saved', savedVideo.status === 200);
  const publicAfter = await call('GET', '/settings/public', null);
  check(
    'and is served to the storefront',
    publicAfter.body.data.content.storyVideoUrl === clip,
    String(publicAfter.body.data.content.storyVideoUrl),
  );

  section('Business contact details belong to the owner, not the code');
  /*
   * Phone, address, hours and social links used to live in the frontend config
   * as `+92 300 1234567` and `facebook.com/featherandbone`, so every business
   * running this software published somebody else's contact details.
   */
  /*
   * Capture first, restore exactly.
   *
   * This suite runs against a shared database and originally put the phone
   * back as '' rather than to whatever it had been — which quietly erased the
   * business's real phone number from the seed, so the receipt and the footer
   * printed without it and nothing said why. A test that leaves the database
   * different from how it found it is a bug generator, not a safety net.
   */
  const originalBusiness = (await call('GET', '/settings/public', null)).body.data.business;

  const contact = await call('PATCH', '/settings/business', superToken, {
    businessPhone: '+92 311 9999999',
    businessHours: 'Mon-Sun 9-9',
    socialFacebook: 'https://facebook.com/regression-test',
  });
  check('contact details are editable', contact.status === 200, JSON.stringify(contact.body).slice(0, 140));

  const site = await call('GET', '/settings/public', null);
  check('phone reaches the storefront', site.body.data.business.phone === '+92 311 9999999');
  check('opening hours reach the storefront', site.body.data.business.hours === 'Mon-Sun 9-9');
  check(
    'social links reach the storefront',
    site.body.data.business.social?.facebook === 'https://facebook.com/regression-test',
  );

  // Blank them to prove omission…
  await call('PATCH', '/settings/business', superToken, {
    businessPhone: '',
    businessHours: '',
    socialFacebook: '',
  });
  const cleared = await call('GET', '/settings/public', null);
  check(
    'a blank link is OMITTED, never blank-rendered',
    !('facebook' in (cleared.body.data.business.social ?? {})),
    'an icon linking nowhere is worse than no icon',
  );

  // …then put back exactly what was there before this suite touched it.
  await call('PATCH', '/settings/business', superToken, {
    businessPhone: originalBusiness.phone ?? '',
    businessHours: originalBusiness.hours ?? '',
    socialFacebook: originalBusiness.social?.facebook ?? '',
  });
  const restored = (await call('GET', '/settings/public', null)).body.data.business;
  check(
    'the suite leaves the business details as it found them',
    restored.phone === (originalBusiness.phone ?? ''),
    `expected ${JSON.stringify(originalBusiness.phone)}, got ${JSON.stringify(restored.phone)}`,
  );

  section('Uploads must be what they claim to be');
  /*
   * The MIME type is a string the client chooses. It is not derived from the
   * bytes, so an allow-list checked against it alone is decorative: a probe put
   * a Windows executable through as `evil.png` with `Content-Type: image/png`
   * and the server stored it. The uploads folder is served publicly, so that
   * turns the shop's own domain into a download host for someone else's binary.
   *
   * These assertions check the content, which is the only thing that cannot be
   * lied about.
   */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const EXE = Buffer.from([
    0x4d, 0x5a, 0x90, 0x00, 0x03, 0x20, 0x6e, 0x6f, 0x74, 0x20, 0x61, 0x6e, 0x20, 0x69, 0x6d, 0x61, 0x67,
    0x65,
  ]);
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);

  const upload = async (endpoint, bytes, filename, declaredType) => {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: declaredType }), filename);
    const res = await fetch(`${API}/admin/catalog/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const realPng = await upload('uploads', PNG, 'photo.png', 'image/png');
  check('a real PNG uploads', realPng.status === 201, JSON.stringify(realPng.body).slice(0, 140));

  const disguised = await upload('uploads', EXE, 'evil.png', 'image/png');
  check(
    'an executable renamed .png is REFUSED',
    disguised.status >= 400,
    `got ${disguised.status} — the shop would be hosting somebody else's binary`,
  );

  const videoAsImage = await upload('uploads', MP4, 'clip.png', 'image/png');
  check(
    'a video cannot sneak into the image endpoint',
    videoAsImage.status >= 400,
    `got ${videoAsImage.status}`,
  );

  const realVideo = await upload('uploads/media', MP4, 'clip.mp4', 'video/mp4');
  check(
    'a real video uploads to the media endpoint',
    realVideo.status === 201,
    JSON.stringify(realVideo.body).slice(0, 140),
  );
  check(
    'it is stored as a video, not by its claimed name',
    realVideo.body?.data?.kind === 'video' && realVideo.body?.data?.url.endsWith('.mp4'),
    realVideo.body?.data?.url,
  );

  const mislabelled = await upload('uploads/media', MP4, 'clip.png', 'image/png');
  check(
    'a mislabelled video gets the CORRECT extension',
    mislabelled.body?.data?.url?.endsWith('.mp4'),
    `${mislabelled.body?.data?.url} — served as .png it would be a broken image`,
  );

  section('sitemap.xml');
  /*
   * A sitemap is a set of promises about pages a stranger can open. Listing a
   * till-only item breaks that promise — the URL 404s for the crawler — and
   * leaks the shape of the internal catalogue at the same time. A crawler that
   * meets dead URLs learns the site is unreliable and returns less often.
   */
  const sitemap = await fetch(`${ORIGIN}/sitemap.xml`);
  const xml = await sitemap.text();

  check('served at the ROOT, not under /api', sitemap.status === 200, `got ${sitemap.status}`);
  check(
    'declares itself as XML',
    (sitemap.headers.get('content-type') ?? '').includes('xml'),
    sitemap.headers.get('content-type'),
  );
  check(
    'is well-formed',
    (xml.match(/<url>/g) ?? []).length === (xml.match(/<\/url>/g) ?? []).length && xml.includes('<urlset'),
    'unbalanced <url> tags would make the whole file unreadable to a crawler',
  );

  check(
    'points at the WEBSITE, not the API',
    // Links go to the website (CLIENT_URL), never to the API's own address.
    xml.includes('<loc>http') && !xml.includes(`<loc>${ORIGIN}`),
    'listing api.host/menu sends every crawler to JSON',
  );

  const seoCat = (await call('GET', '/admin/catalog/categories', superToken)).body.data[0];
  const seoStamp = Date.now();
  const mk = (name, channels, barcode) =>
    call('POST', '/admin/catalog/products', superToken, {
      name,
      category: seoCat.id ?? seoCat._id,
      price: 100,
      unit: 'pcs',
      stock: 5,
      channels,
      barcode,
    });

  const webItem = await mk(`SeoWeb ${seoStamp}`, ['web'], String(seoStamp).slice(-10));
  const tillItem = await mk(`SeoTill ${seoStamp}`, ['pos'], String(seoStamp + 1).slice(-10));

  const refreshed = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
  check('a public item IS listed', refreshed.includes(`seoweb-${seoStamp}`));
  check(
    'a till-only item is NOT listed',
    !refreshed.includes(`seotill-${seoStamp}`),
    'that URL does not exist publicly — listing it teaches the crawler to distrust the site',
  );

  // An inactive item must drop out too.
  await call('PATCH', `/admin/catalog/products/${webItem.body.data.id}`, superToken, { isActive: false });
  const afterHide = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
  check('hiding an item removes it from the sitemap', !afterHide.includes(`seoweb-${seoStamp}`));

  await call('DELETE', `/admin/catalog/products/${webItem.body.data.id}`, superToken);
  await call('DELETE', `/admin/catalog/products/${tillItem.body.data.id}`, superToken);

  return report();
}
