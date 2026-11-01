/**
 * Build the two upload-ready zips for WebHoster.pk (cPanel).
 * ---------------------------------------------------------------------------
 *   npm run package:webhoster
 *   npm run package:webhoster -- --api-url=https://other-host/api/v1
 *
 * Produces, in deploy/out/:
 *
 *   featherbone-frontend.zip  → extract INTO public_html (featherbonepk.com)
 *   featherbone-backend.zip   → extract INTO the Node.js application root
 *
 * Step-by-step instructions: deploy/WEBHOSTER.md.
 *
 * Why a script instead of zipping folders by hand. Each of these has broken a
 * cPanel deployment, and none of them is visible in a hand-made zip:
 *
 *   • node_modules inside the app root. CloudLinux's Node.js Selector keeps
 *     dependencies in a separate virtual environment and links them in as
 *     `node_modules`; a real folder of that name makes "Run NPM Install" refuse
 *     to run. It is never packed.
 *
 *   • devDependencies on the server. mongodb-memory-server downloads a ~100MB
 *     MongoDB binary during install, which shared hosting kills half-way. The
 *     backend's package.json is rewritten with production dependencies only,
 *     pinned to the exact versions installed and tested here.
 *
 *   • .env in the zip. Secrets never leave this machine inside an archive; the
 *     server keeps its own .env, written once from .env.example.
 *
 *   • A bundle built against the wrong API. VITE_API_URL is compiled into the
 *     JavaScript, so the built files are searched for the address afterwards —
 *     the zip is refused if it is not there.
 *
 *   • A missing .htaccess. Explorer and Finder hide dotfiles, so it is the file
 *     most often left behind — and without it every page refresh is a 404.
 *
 * No dependencies beyond the repo's own: zips are written by the small writer
 * at the bottom, so this runs the same on Windows, macOS and Linux.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
const BACKEND = path.join(ROOT, 'backend');
const OUT = path.join(ROOT, 'deploy', 'out');

const say = (line = '') => process.stdout.write(`${line}\n`);
const die = (message) => {
  process.stderr.write(`\n✖ ${message}\n\n`);
  process.exit(1);
};

// --- Arguments ---------------------------------------------------------------
const args = process.argv.slice(2);
const option = (name) => {
  const prefix = `--${name}=`;
  const inline = args.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};
const skipBuild = args.includes('--skip-build');

// --- Which API the storefront will talk to ------------------------------------
/** The VITE_API_URL line in frontend/.env.production — the committed default. */
function committedApiUrl() {
  const file = path.join(FRONTEND, '.env.production');
  if (!fs.existsSync(file)) return undefined;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const match = lines
    .map((l) => l.match(/^\s*VITE_API_URL\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .pop();
  return match?.[1].replace(/^["']|["']$/g, '');
}

const apiUrl = (option('api-url') ?? committedApiUrl() ?? '').trim().replace(/\/+$/, '');

let api;
try {
  api = new URL(apiUrl);
} catch {
  die(
    `No usable API address (got "${apiUrl}"). Set VITE_API_URL in frontend/.env.production or pass --api-url=…`,
  );
}
if (['localhost', '127.0.0.1', '::1'].includes(api.hostname)) {
  die(
    `The API address is ${apiUrl}. In a visitor's browser that means THEIR computer — every request would fail.`,
  );
}
if (api.protocol !== 'https:') {
  die(
    `The API address must be https:// (got ${apiUrl}). The site is served over HTTPS, and browsers block calls to http:// from it.`,
  );
}
if (api.pathname === '/' || api.pathname === '') {
  die(`${apiUrl} has no path. The API lives under /api/v1 — use ${apiUrl}/api/v1.`);
}

say(`\nFeather & Bone → WebHoster.pk packages`);
say(`  API the storefront will call: ${apiUrl}`);

// --- 1. Frontend ------------------------------------------------------------------
const DIST = path.join(FRONTEND, 'dist');

if (!skipBuild) {
  say('\n[1/3] Building the storefront…');
  /*
   * A variable already in the environment beats the .env files — Vite never
   * overwrites one — so this is how --api-url replaces .env.production for this
   * build without anyone editing, and then forgetting to revert, the file.
   */
  process.env.VITE_API_URL = apiUrl;
  // Vite's own API rather than spawning `npm run build`: spawning npm.cmd on
  // Windows needs a shell, and this has to run the same on every machine.
  const { build } = await import('vite').catch(() =>
    die('Vite is not installed. Run `npm install` in the project root first.'),
  );
  /*
   * From inside frontend/, as `npm --workspace frontend run build` does.
   * Tailwind finds tailwind.config.js — and resolves its `./src/**` content
   * globs — relative to the current directory, not Vite's root. Built from the
   * repo root it finds no config, generates none of the theme's classes, and
   * fails on the first @apply.
   */
  const previous = process.cwd();
  process.chdir(FRONTEND);
  try {
    await build({ root: FRONTEND, mode: 'production', logLevel: 'warn' });
  } finally {
    process.chdir(previous);
  }
} else {
  say('\n[1/3] --skip-build: using the existing frontend/dist');
}

for (const required of ['index.html', '.htaccess']) {
  if (!fs.existsSync(path.join(DIST, required))) {
    die(`frontend/dist/${required} is missing — the build did not complete.`);
  }
}

/*
 * Prove the bundle targets the API we just printed. Vite inlines the address as
 * a string literal, so it must appear somewhere in the emitted JavaScript.
 */
const assetsDir = path.join(DIST, 'assets');
const bundled = fs
  .readdirSync(assetsDir)
  .filter((f) => f.endsWith('.js'))
  .some((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8').includes(apiUrl));
if (!bundled) {
  die(
    `The built JavaScript does not contain ${apiUrl}.\n` +
      '  frontend/dist is from a different build — run without --skip-build.',
  );
}

/*
 * The sitemap is served by the API, so robots.txt must name the API's host. The
 * committed file names backend.featherbonepk.com; an --api-url build elsewhere
 * gets its own host written in, here, in the copy that ships.
 */
const robotsPath = path.join(DIST, 'robots.txt');
if (fs.existsSync(robotsPath)) {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  const fixed = robots.replace(/^Sitemap:.*$/m, `Sitemap: ${api.origin}/sitemap.xml`);
  if (fixed !== robots) fs.writeFileSync(robotsPath, fixed);
}

fs.mkdirSync(OUT, { recursive: true });

/*
 * _redirects and vercel.json belong to Netlify/Cloudflare and Vercel. Apache
 * ignores them, and shipping them only invites the question of which file is
 * in charge. .htaccess is the one that is.
 */
const frontendFiles = walk(DIST, DIST).filter(({ rel }) => !['_redirects', 'vercel.json'].includes(rel));
const frontendZip = path.join(OUT, 'featherbone-frontend.zip');
writeZip(frontendZip, frontendFiles);
say(
  `\n[2/3] Storefront → ${path.relative(ROOT, frontendZip)}  (${frontendFiles.length} files, ${mb(frontendZip)})`,
);

// --- 2. Backend -------------------------------------------------------------------
/*
 * Only what runs in production. tests/, lint and nodemon config stay home, and
 * so do the in-memory database scripts, which need devDependencies that are
 * deliberately not installed on the server.
 */
const DEV_ONLY_SCRIPTS = new Set(['scripts/dev-env.mjs', 'scripts/dev-memory-db.mjs']);

const backendFiles = [
  ...walk(path.join(BACKEND, 'src'), BACKEND),
  ...walk(path.join(BACKEND, 'scripts'), BACKEND).filter(({ rel }) => !DEV_ONLY_SCRIPTS.has(rel)),
  { rel: 'cpanel-start.cjs', abs: path.join(BACKEND, 'cpanel-start.cjs') },
  { rel: '.env.example', abs: path.join(BACKEND, '.env.example') },
];

for (const { rel, abs } of backendFiles) {
  if (!fs.existsSync(abs)) die(`backend/${rel} is missing.`);
}

const sourcePackage = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));

/** The exact version installed here, so the server runs what was tested. */
function installedVersion(name, range) {
  for (const base of [path.join(BACKEND, 'node_modules'), path.join(ROOT, 'node_modules')]) {
    const file = path.join(base, name, 'package.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).version;
  }
  say(`  ! ${name} is not installed locally — keeping the range ${range}`);
  return range;
}

const PRODUCTION_SCRIPTS = [
  'start',
  'owner',
  'doctor',
  'check:db',
  'expire:reservations',
  'migrate:media',
  'migrate:channels',
];

const deployPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: sourcePackage.type,
  description: sourcePackage.description,
  main: sourcePackage.main,
  engines: { node: '>=20' },
  scripts: Object.fromEntries(
    PRODUCTION_SCRIPTS.filter((s) => sourcePackage.scripts?.[s]).map((s) => [s, sourcePackage.scripts[s]]),
  ),
  dependencies: Object.fromEntries(
    Object.entries(sourcePackage.dependencies).map(([name, range]) => [name, installedVersion(name, range)]),
  ),
};

const backendZip = path.join(OUT, 'featherbone-backend.zip');
writeZip(backendZip, [
  ...backendFiles,
  { rel: 'package.json', data: Buffer.from(`${JSON.stringify(deployPackage, null, 2)}\n`) },
]);
say(
  `[3/3] API         → ${path.relative(ROOT, backendZip)}  (${backendFiles.length + 1} files, ${mb(backendZip)})`,
);

say(`
Next:
  1. Check the API → ${api.origin}/health  must show "database":"connected"
       API on Vercel (current setup): nothing to upload — see deploy/VERCEL.md
       API on cPanel: extract the backend zip into the Node.js app root
                      (NOT public_html) — see deploy/WEBHOSTER.md
  2. Frontend zip  → extract into public_html of featherbonepk.com.
`);

// =============================================================================
// Helpers
// =============================================================================

/** Every file under `dir`, with its path relative to `base` in zip (/) form. */
function walk(dir, base) {
  const skip = new Set(['node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile()) out.push({ rel: path.relative(base, abs).split(path.sep).join('/'), abs });
  }
  return out;
}

function mb(file) {
  return `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`;
}

/* --- Minimal ZIP writer --------------------------------------------------------
 * PKZIP 2.0: deflate (or store, when deflate does not help — photos and video),
 * UTF-8 names, explicit directory entries, Unix permissions 0644/0755 so cPanel's
 * extractor never produces files Apache cannot read. No ZIP64; these archives
 * are a few MB and the format allows 4 GB. */

/*
 * The table hangs off the (hoisted) function rather than living in a module
 * `const`: the top-level code above runs before this point in the file is
 * reached, and a `const` here would still be uninitialised when it is called.
 */
function crc32(buffer) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  const table = crc32.table;
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * @param {string} target
 * @param {{ rel: string, abs?: string, data?: Buffer }[]} files
 */
function writeZip(target, files) {
  const { time, day } = dosDateTime(new Date());
  const entries = [];

  // Parent directories first, so every extractor has somewhere to put files.
  const dirs = new Set();
  for (const { rel } of files) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  for (const dir of [...dirs].sort()) entries.push({ name: dir, data: Buffer.alloc(0), dir: true });
  for (const file of files) entries.push({ name: file.rel, data: file.data ?? fs.readFileSync(file.abs) });

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const deflated = entry.dir ? entry.data : zlib.deflateRawSync(entry.data, { level: 9 });
    const useDeflate = !entry.dir && deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk
    header.writeUInt16LE(0, 36); // internal attributes
    const mode = entry.dir ? 0o040755 : 0o100644;
    header.writeUInt32LE(((mode << 16) | (entry.dir ? 0x10 : 0)) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + body.length;
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(target, Buffer.concat([...chunks, ...central, end]));
}
