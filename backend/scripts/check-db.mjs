/**
 * Why can this server not reach MongoDB?
 * ---------------------------------------------------------------------------
 *   npm run check:db
 *
 * "Could not connect to any servers in your MongoDB Atlas cluster" is the same
 * message for three unrelated causes, and the fix differs completely:
 *
 *   1. DNS cannot resolve the cluster        → wrong host in MONGODB_URI
 *   2. DNS works, the TCP port is closed     → the HOST blocks outbound 27017
 *   3. The port is open, the handshake fails → Atlas IP allow-list, or the
 *                                               username/password is wrong
 *
 * Atlas's own wording only ever suggests the third, which is why people spend
 * an afternoon re-adding 0.0.0.0/0 to fix a firewall. This separates them.
 *
 * Safe: read-only. It resolves a name, opens a socket, and asks the server to
 * identify itself. It never reads or writes application data, and it prints no
 * credentials.
 */
import net from 'node:net';
import dns from 'node:dns/promises';

import { env } from '../src/config/env.config.js';

const line = '─'.repeat(64);
const say = (s = '') => process.stdout.write(`${s}\n`);

/** Host and port to dial, resolving the SRV record an `mongodb+srv://` URI implies. */
async function resolveTargets(uri) {
  const isSrv = uri.startsWith('mongodb+srv://');
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  // Strip credentials before the @, and anything after the host section.
  const hostPart = withoutScheme.split('@').pop().split('/')[0].split('?')[0];

  if (!isSrv) {
    return hostPart.split(',').map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: Number(port) || 27017 };
    });
  }

  // An +srv URI names a lookup, not a server: the real shard hostnames live in
  // a DNS SRV record, and that lookup is itself a thing that can fail.
  const records = await dns.resolveSrv(`_mongodb._tcp.${hostPart}`);
  return records.map((r) => ({ host: r.name, port: r.port }));
}

/** Can we open a TCP socket at all? This is the question a firewall answers. */
function probe({ host, port }, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ ok: true }));
    socket.once('timeout', () => done({ ok: false, reason: 'timed out — no reply at all' }));
    socket.once('error', (error) => done({ ok: false, reason: `${error.code ?? error.message}` }));
    socket.connect(port, host);
  });
}

say(`\n${line}\n  MONGODB REACHABILITY\n${line}`);

// The URI itself, with the password removed — enough to spot a wrong cluster
// or a missing database name, without putting a credential in a log.
const safeUri = env.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:••••@');
say(`  URI       ${safeUri}`);

let targets;
try {
  targets = await resolveTargets(env.MONGODB_URI);
  say(`  DNS       ok — ${targets.length} server(s) found`);
} catch (error) {
  say(`  DNS       FAILED (${error.code ?? error.message})\n`);
  say('  The cluster hostname could not be resolved. Check MONGODB_URI for a');
  say('  typo, and that the cluster still exists in Atlas.\n');
  process.exit(1);
}

say('');
let anyOpen = false;
for (const target of targets) {
  const result = await probe(target);
  if (result.ok) anyOpen = true;
  say(
    `  ${result.ok ? 'OPEN  ' : 'BLOCKED'}  ${target.host}:${target.port}${result.ok ? '' : `  (${result.reason})`}`,
  );
}

say(`\n${line}`);

if (!anyOpen) {
  say('  VERDICT: this server cannot open port 27017.\n');
  say('  This is NOT an Atlas allow-list problem — the connection is being');
  say('  stopped before it ever reaches MongoDB. Shared hosting commonly blocks');
  say('  outbound ports other than 80 and 443.\n');
  say('  Ask your host:');
  say('    "Please allow outbound TCP on port 27017 for MongoDB Atlas."\n');
  say('  If they will not, the API has to run somewhere that permits it.');
  say(`${line}\n`);
  process.exit(1);
}

say('  The port is open, so the network is fine. Trying the handshake…\n');

// The port being open proves nothing about credentials. This is the step that
// distinguishes "IP not allow-listed" from "wrong password".
const mongoose = (await import('mongoose')).default;
try {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  say(`  CONNECTED — database "${mongoose.connection.name}"\n`);
  say('  Everything works from here. If the application still fails, it is');
  say('  reading a different MONGODB_URI than this command just used.');
  await mongoose.connection.close();
  say(`${line}\n`);
} catch (error) {
  const message = error.message ?? '';
  say(`  HANDSHAKE FAILED: ${message.split('\n')[0]}\n`);

  if (/auth|password|credential/i.test(message)) {
    say('  The username or password in MONGODB_URI is wrong. Reset it in');
    say('  Atlas → Database Access. Remember to URL-encode @ : / ? # in a');
    say('  password, or it will break the URI.');
  } else {
    say('  The port is open but Atlas refused the session, which points at the');
    say('  IP allow-list. In Atlas → Network Access, confirm 0.0.0.0/0 is');
    say('  listed as ACTIVE (not Pending, and not an expired temporary entry),');
    say('  and that you are looking at the project this cluster belongs to.');
  }
  say(`${line}\n`);
  process.exit(1);
}
