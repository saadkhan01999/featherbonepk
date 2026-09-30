/**
 * Image upload, replacement and deletion.
 * ---------------------------------------------------------------------------
 * The upload endpoint is one of the most attacked parts of any admin panel, and
 * the lifecycle around it is where storage quietly leaks: an image replaced ten
 * times leaves nine orphans behind unless something deletes them, and a delete
 * that is too eager blanks a photo another product is still using.
 *
 * Which driver this runs against: always `local`, forced by dev:memdb into a
 * temporary directory that goes away with the database.
 *
 * It used to follow whatever UPLOAD_DRIVER said, and on an installation
 * configured for production that meant the suite uploaded to the real
 * Cloudinary account — which broke it in two ways that both looked like
 * application bugs. The video fixtures are deliberately tiny (a valid `ftyp`
 * header and no frames), so Cloudinary refused them as undecodable; and the
 * deletion checks below assert an asset stops resolving, which a CDN does not
 * do on demand, because `invalidate` schedules a purge rather than performing
 * one. Correct code, failing tests, for reasons belonging to somebody else's
 * servers.
 *
 * The Cloudinary path is still covered, lower down in this file, against a
 * stubbed fetch — which is what lets us assert the exact request shape,
 * including that the API secret never travels. That `destroy` genuinely reaches
 * a real account is the one thing no test here can prove; `npm run doctor`
 * performs that round trip against live credentials instead.
 */
import { suite, call, login, upload, REAL_PNG, ORIGIN, OWNER_EMAIL } from './harness.mjs';
import {
  parseCloudinaryUrl,
  isManagedAsset,
  uploadToCloudinary,
  destroyCloudinaryAsset,
} from '../src/core/storage/media.storage.js';

/** Is this URL still fetchable? */
async function exists(url) {
  const absolute = url.startsWith('http') ? url : `${ORIGIN}${url}`;
  try {
    const response = await fetch(absolute);
    return response.status === 200;
  } catch {
    return false;
  }
}

export default async function run() {
  const { check, section, report } = suite('media');

  const superToken = await login(OWNER_EMAIL);
  const cashierToken = await login('cashier@featherandbone.dev');

  const categories = (await call('GET', '/admin/catalog/categories', superToken)).body.data ?? [];
  const categoryId = categories[0]?.id ?? String(categories[0]?._id);

  /*
   * Every product this suite creates is removed again.
   *
   * The suites share one database, and a leftover product is not an inert
   * record: it belongs to a category, has no store, and therefore makes that
   * category appear on every till. The stores suite asserts the opposite and
   * duly failed on the second run against the same database — a failure that
   * pointed at store scoping while the actual cause was rubbish left here.
   */
  const created = [];

  const createProduct = async (body) => {
    const result = await call('POST', '/admin/catalog/products', superToken, {
      category: categoryId,
      price: 100,
      stock: 3,
      ...body,
    });
    if (result.body.data?.id) created.push(result.body.data.id);
    return result;
  };

  const cleanUp = async () => {
    for (const id of created) {
      await call('DELETE', `/admin/catalog/products/${id}`, superToken);
    }
  };

  // =========================================================================
  section('Only staff who manage products may upload');
  // =========================================================================
  check(
    'an anonymous upload is refused',
    (await upload('/admin/catalog/uploads', null, REAL_PNG)).status === 401,
  );
  check(
    'a cashier cannot upload product art',
    (await upload('/admin/catalog/uploads', cashierToken, REAL_PNG)).status === 403,
  );

  // =========================================================================
  section('A file must be what it claims to be');
  // =========================================================================
  const disguised = await upload(
    '/admin/catalog/uploads',
    superToken,
    // A Windows executable's magic bytes, announced as a PNG. The declared MIME
    // type is a string the client chooses; only the bytes are evidence.
    Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'binary'),
    'totally-a-photo.png',
    'image/png',
  );
  check('an executable dressed as a PNG is rejected', disguised.status === 400, `got ${disguised.status}`);

  const svg = await upload(
    '/admin/catalog/uploads',
    superToken,
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    'xss.svg',
    'image/svg+xml',
  );
  check('SVG is refused — it can carry script', svg.status === 400);

  const traversal = await upload(
    '/admin/catalog/uploads',
    superToken,
    REAL_PNG,
    '../../../../server.js',
    'image/png',
  );
  check(
    'a traversal filename is not used verbatim',
    traversal.status !== 201 || !traversal.body.data.url.includes('..'),
  );

  // =========================================================================
  section('A real image uploads and is served back');
  // =========================================================================
  const first = await upload('/admin/catalog/uploads', superToken, REAL_PNG);
  check('a genuine PNG is accepted', first.status === 201, `got ${first.status}`);

  const firstUrl = first.body.data?.url;
  check('a URL comes back', Boolean(firstUrl));
  check(
    'the stored name is not the name we sent',
    !String(firstUrl).includes('photo.png'),
    'a client-chosen filename is how shell.php gets written',
  );
  check('the image is reachable', await exists(firstUrl));

  // =========================================================================
  section('Replacing an image deletes the one it replaced');
  // =========================================================================
  const withFirst = await createProduct({
    name: `Media Test Item ${Date.now()}`,
    price: 500,
    stock: 5,
    image: firstUrl,
  });
  check('a product can be created with it', withFirst.status === 201, withFirst.body.message);
  const productId = withFirst.body.data?.id;

  const second = await upload('/admin/catalog/uploads', superToken, REAL_PNG);
  const secondUrl = second.body.data?.url;
  check('a replacement uploads', second.status === 201 && Boolean(secondUrl));
  check('the two are different assets', firstUrl !== secondUrl);

  const replaced = await call('PATCH', `/admin/catalog/products/${productId}`, superToken, {
    image: secondUrl,
  });
  check('the product takes the new image', replaced.body.data?.image === secondUrl);
  check('the new image is reachable', await exists(secondUrl));
  check(
    'the OLD image is deleted',
    !(await exists(firstUrl)),
    'every replacement would otherwise leak an orphan forever',
  );

  // =========================================================================
  section('An image two records share is not deleted from under one of them');
  // =========================================================================
  const shared = await upload('/admin/catalog/uploads', superToken, REAL_PNG);
  const sharedUrl = shared.body.data.url;

  const holderA = await createProduct({ name: `Shared Art A ${Date.now()}`, image: sharedUrl });
  const holderB = await createProduct({ name: `Shared Art B ${Date.now()}`, image: sharedUrl });
  check('two products can use one photo', holderA.status === 201 && holderB.status === 201);

  await call('PATCH', `/admin/catalog/products/${holderA.body.data.id}`, superToken, { image: null });
  check(
    'one letting go does NOT delete the shared photo',
    await exists(sharedUrl),
    "the other product's image would silently stop loading",
  );

  await call('DELETE', `/admin/catalog/products/${holderB.body.data.id}`, superToken);
  check('once nothing references it, it is deleted', !(await exists(sharedUrl)));

  // =========================================================================
  section('Deleting a product deletes its image');
  // =========================================================================
  const deleted = await call('DELETE', `/admin/catalog/products/${productId}`, superToken);
  check('an unsold product is deleted outright', deleted.body.data?.action === 'deleted');
  check('and its image goes with it', !(await exists(secondUrl)));

  // =========================================================================
  section('Removing an image clears it');
  // =========================================================================
  const lone = await upload('/admin/catalog/uploads', superToken, REAL_PNG);
  const loneUrl = lone.body.data.url;
  const withImage = await createProduct({
    name: `Removable Art ${Date.now()}`,
    price: 250,
    stock: 2,
    image: loneUrl,
  });

  const cleared = await call('PATCH', `/admin/catalog/products/${withImage.body.data.id}`, superToken, {
    image: null,
  });
  check('the record drops the image', !cleared.body.data?.image);
  check('and the asset is deleted', !(await exists(loneUrl)));

  // A PATCH that does not mention the image must leave it alone — the most
  // dangerous false positive in this whole area.
  const keeper = await upload('/admin/catalog/uploads', superToken, REAL_PNG);
  const keeperUrl = keeper.body.data.url;
  const untouched = await createProduct({
    name: `Price Edit Art ${Date.now()}`,
    price: 300,
    stock: 4,
    image: keeperUrl,
  });
  await call('PATCH', `/admin/catalog/products/${untouched.body.data.id}`, superToken, { price: 350 });
  check(
    'editing an unrelated field keeps the image',
    await exists(keeperUrl),
    'a price change must never destroy the photo',
  );

  // =========================================================================
  section('A failed save does not leave the upload orphaned');
  // =========================================================================
  const orphan = await upload('/admin/catalog/uploads', superToken, REAL_PNG);
  const orphanUrl = orphan.body.data.url;

  const rejected = await createProduct({
    name: `Doomed Item ${Date.now()}`,
    // A syntactically valid id that no category has — accepted by validation,
    // refused by the service, which is what makes the write fail late.
    category: '0123456789abcdef01234567',
    price: 200,
    stock: 1,
    image: orphanUrl,
  });
  check('the product is refused', rejected.status >= 400);
  check(
    'and the image it would have used is cleaned up',
    !(await exists(orphanUrl)),
    'an upload for a record that never existed is unreachable forever',
  );

  // =========================================================================
  section('Cloudinary URLs are understood without a Cloudinary account');
  // =========================================================================
  // Pure URL parsing — the step that decides which asset a delete destroys.
  // Getting it wrong deletes the wrong image, or silently deletes nothing.
  const plain = parseCloudinaryUrl(
    'https://res.cloudinary.com/demo/image/upload/v1712345678/feather-and-bone/2026-08/abc123.png',
  );
  check(
    'a plain delivery URL yields its public id',
    plain?.publicId === 'feather-and-bone/2026-08/abc123' && plain.resourceType === 'image',
    JSON.stringify(plain),
  );

  const transformed = parseCloudinaryUrl(
    'https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1/feather-and-bone/2026-08/abc123.webp',
  );
  check(
    'transformations are stripped, not treated as part of the id',
    transformed?.publicId === 'feather-and-bone/2026-08/abc123',
    JSON.stringify(transformed),
  );

  const video = parseCloudinaryUrl(
    'https://res.cloudinary.com/demo/video/upload/v1/feather-and-bone/2026-08/clip.mp4',
  );
  check('a video URL reports resource_type video', video?.resourceType === 'video');

  check(
    'a legacy /uploads path is not mistaken for one',
    parseCloudinaryUrl('/uploads/2026-08/a.png') === null,
  );
  check('nor is an unrelated host', parseCloudinaryUrl('https://example.com/image/upload/v1/a.png') === null);

  check('legacy local URLs are still ours to manage', isManagedAsset('/uploads/2026-08/a.png'));
  check(
    'a hand-pasted external URL is NOT ours to delete',
    !isManagedAsset('https://example.com/photo.jpg'),
    'replacing it must not try to destroy somebody else’s file',
  );
  check('bundled client art is left alone', !isManagedAsset('/images/products/bbq.svg'));

  // =========================================================================
  section('What we actually ask Cloudinary to do');
  // =========================================================================
  /*
   * `fetch` is stubbed — so what is asserted is the request we actually make.
   *
   * Without an account the interesting question is not whether Cloudinary
   * accepts us; it is whether we ask for the right thing: the public id we
   * chose, a signature instead of the secret, no silent overwrite, a video sent
   * as a video, and a delete naming the same asset the URL came from. All of
   * that is visible in the outgoing form, and all of it is ours to get wrong.
   */
  const realFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options) => {
    const form = options.body;
    const fields = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, value instanceof Blob ? value : String(value)]),
    );
    requests.push({ url: String(url), fields });

    const isDestroy = String(url).includes('/destroy');
    const publicId = fields.public_id;

    return {
      ok: true,
      json: async () =>
        isDestroy
          ? { result: 'ok' }
          : {
              public_id: publicId,
              secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.png`,
            },
    };
  };

  try {
    const stored = await uploadToCloudinary({ mimetype: 'image/png', buffer: REAL_PNG });
    const sent = requests.at(-1);

    check('an image is uploaded to the image endpoint', sent.url.endsWith('/image/upload'), sent.url);
    check('the file itself is attached', sent.fields.file instanceof Blob);
    check('the whole file is sent', sent.fields.file?.size === REAL_PNG.length);
    check(
      'we choose the public id, filed under the configured folder',
      /^feather-and-bone\/\d{4}-\d{2}\/[0-9a-f]{32}$/.test(sent.fields.public_id),
      sent.fields.public_id,
    );
    check(
      'the client filename is never used to derive one',
      sent.fields.use_filename === 'false' && sent.fields.unique_filename === 'false',
    );
    check(
      'an existing asset is never silently overwritten',
      sent.fields.overwrite === 'false',
      'a public-id collision must fail loudly, not replace someone else\u2019s photo',
    );

    check('the request is signed', Boolean(sent.fields.signature) && Boolean(sent.fields.timestamp));
    check(
      'the API SECRET is never transmitted',
      !Object.values(sent.fields).some(
        (value) =>
          typeof value === 'string' && value.includes(process.env.CLOUDINARY_API_SECRET ?? '\u0000never'),
      ),
      'the signature exists precisely so the secret does not have to travel',
    );
    check('the HTTPS delivery URL is what gets stored', stored.url.startsWith('https://res.cloudinary.com/'));

    await uploadToCloudinary({ mimetype: 'video/mp4', buffer: REAL_PNG });
    check('a video goes to the video endpoint', requests.at(-1).url.endsWith('/video/upload'));

    // The round trip that matters: upload -> URL -> parse -> delete the same asset.
    const roundTrip = parseCloudinaryUrl(stored.url);
    check('the stored URL parses back to the id we chose', roundTrip?.publicId === stored.publicId);

    check('deleting reports success', (await destroyCloudinaryAsset(roundTrip)) === true);
    const destroyRequest = requests.at(-1);
    check('it names the right asset', destroyRequest.fields.public_id === stored.publicId);
    check(
      'and invalidates the CDN copy',
      destroyRequest.fields.invalidate === 'true',
      'otherwise the deleted image keeps being served from the edge for hours',
    );

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: 'not found' }) });
    check(
      'an already-deleted asset counts as deleted',
      (await destroyCloudinaryAsset({ publicId: 'gone', resourceType: 'image' })) === true,
      'a retried delete must not look like a failure',
    );

    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid Signature' } }),
    });
    let surfaced = null;
    try {
      await uploadToCloudinary({ mimetype: 'image/png', buffer: REAL_PNG });
    } catch (error) {
      surfaced = error.message;
    }
    check(
      "Cloudinary's own reason is surfaced, not a bare status code",
      surfaced === 'Invalid Signature',
      `got ${surfaced} — "invalid signature" and "stale request" need different fixes`,
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  await cleanUp();

  return report();
}
