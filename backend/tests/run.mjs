/**
 * Test runner.
 * ---------------------------------------------------------------------------
 *   npm run dev:memdb      # terminal 1 — API + in-memory database
 *   npm test               # terminal 2
 *
 * Suites run sequentially and share one database on purpose: several of them
 * assert on stock levels, drawer balances and order counts, and those are
 * exactly the figures that go wrong when two suites mutate them concurrently.
 * A parallel runner here would trade real coverage for a few seconds.
 */
import { assertDevServer, bootstrapStaff } from './harness.mjs';

import auth from './auth.test.mjs';
import account from './account.test.mjs';
import rbac from './rbac.test.mjs';
import commerce from './commerce.test.mjs';
import pos from './pos.test.mjs';
import stores from './stores.test.mjs';
import backoffice from './backoffice.test.mjs';
import content from './content.test.mjs';
import adminScreens from './admin-screens.test.mjs';
import recovery from './recovery.test.mjs';
import payments from './payments.test.mjs';
import media from './media.test.mjs';
import kitchen from './kitchen.test.mjs';
import control from './control.test.mjs';
import hours from './hours.test.mjs';
import stations from './stations.test.mjs';

const SUITES = [
  ['Authentication & sessions', auth],
  ['Customer account & wishlist', account],
  ['RBAC, till access & scoped dashboard', rbac],
  ['Checkout, orders & reviews', commerce],
  ['POS: registry, sales, shifts', pos],
  ['Store scoping across tills & reports', stores],
  ['Back office', backoffice],
  ['Owner-editable content', content],
  ['Website, Finance, Logs & Notifications', adminScreens],
  ['Password reset, contact form & search', recovery],
  ['Image upload, replacement & deletion', media],
  ['Kitchen Display, till tickets & live updates', kitchen],
  ['Till menus, reports & exports, payments, ledger, settings, pages', control],
  ['Opening hours, feedback, Order Board, About & Contact', hours],
  ['Stations and forwarding website orders', stations],
  /*
   * Last, because it is the only suite that waits on wall-clock time: it lets a
   * reservation actually expire rather than asserting that the code which would
   * expire it exists. Putting it at the end keeps every fast suite's feedback
   * fast, and its own stock arithmetic is measured before and after each step
   * so a later suite's purchases cannot skew it.
   */
  ['Online payment, held stock & cancellation rights', payments],
];

await assertDevServer();

/*
 * The seed creates one account: the super admin. Everything else the suites
 * sign in as is created here, through the same API the owner uses.
 */
await bootstrapStaff();

const results = [];
const started = Date.now();

for (const [title, run] of SUITES) {
  console.log(`\n${'='.repeat(70)}\n  ${title}\n${'='.repeat(70)}`);
  try {
    results.push(await run());
  } catch (error) {
    // A suite that throws must not take the whole run with it — the remaining
    // suites still carry information about what else is broken.
    console.error(`\n  SUITE CRASHED: ${error.message}`);
    console.error(error.stack?.split('\n').slice(1, 4).join('\n'));
    results.push({ name: title, pass: 0, fail: 1, failures: [`crashed: ${error.message}`] });
  }
}

const pass = results.reduce((sum, r) => sum + r.pass, 0);
const fail = results.reduce((sum, r) => sum + r.fail, 0);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n${'='.repeat(70)}`);
for (const result of results) {
  const status = result.fail === 0 ? 'ok  ' : 'FAIL';
  console.log(`  ${status}  ${result.name.padEnd(14)} ${result.pass} passed, ${result.fail} failed`);
}
console.log('='.repeat(70));

if (fail > 0) {
  console.log('\n  Failures:');
  for (const result of results) {
    for (const failure of result.failures) console.log(`    · [${result.name}] ${failure}`);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed in ${seconds}s\n`);
process.exit(fail > 0 ? 1 : 0);
