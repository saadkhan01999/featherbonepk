/**
 * Customer account: profile, password, addresses, sessions, wishlist.
 */
import { call, login, suite, PW, uniqueEmail, uniquePhone } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('account');

  const aliceEmail = uniqueEmail('alice');
  const bobEmail = uniqueEmail('bob');
  const alice0 = (
    await call('POST', '/auth/register', null, {
      fullName: 'Alice Account',
      email: aliceEmail,
      phone: uniquePhone('0341'),
      password: PW,
    })
  ).body.data?.accessToken;
  const bob = (
    await call('POST', '/auth/register', null, {
      fullName: 'Bob Account',
      email: bobEmail,
      phone: uniquePhone('0342'),
      password: PW,
    })
  ).body.data?.accessToken;

  let alice = alice0;

  section('Profile');
  const profile = await call('GET', '/account', alice);
  check('profile returned', profile.status === 200);
  check('no password leaks', !JSON.stringify(profile.body).includes('password'));

  const renamed = await call('PATCH', '/account', alice, { fullName: 'Alice Renamed' });
  check('name is editable', renamed.status === 200 && renamed.body.data.fullName === 'Alice Renamed');

  await call('PATCH', '/account', alice, { email: 'hijack@evil.test' });
  check(
    'email is NOT editable here',
    (await call('GET', '/account', alice)).body.data.email === aliceEmail,
    'an unverified email change is an account-takeover path via password reset',
  );

  section('Addresses');
  const addr = (n) => ({
    recipientName: `Recipient ${n}`,
    phone: '03001234567',
    line1: `${n} Chota Chowk`,
    city: 'Mardan',
    label: 'home',
  });
  await call('POST', '/account/addresses', alice, addr(1));
  let list = (await call('GET', '/account/addresses', alice)).body.data;
  check('the first address becomes the default automatically', list[0]?.isDefault === true);

  await call('POST', '/account/addresses', alice, addr(2));
  list = (await call('GET', '/account/addresses', alice)).body.data;
  check('exactly one default with two addresses', list.filter((a) => a.isDefault).length === 1);

  const currentDefault = list.find((a) => a.isDefault);
  await call('DELETE', `/account/addresses/${currentDefault.id}`, alice);
  list = (await call('GET', '/account/addresses', alice)).body.data;
  check('deleting the default promotes another', list.length === 1 && list[0].isDefault === true);

  section('Address ownership');
  const aliceAddress = list[0];
  check(
    "Bob sees none of Alice's addresses",
    (await call('GET', '/account/addresses', bob)).body.data.length === 0,
  );
  check(
    "Bob cannot edit Alice's address",
    (await call('PATCH', `/account/addresses/${aliceAddress.id}`, bob, { city: 'Hacked' })).status === 404,
  );
  check(
    "Bob cannot delete Alice's address",
    (await call('DELETE', `/account/addresses/${aliceAddress.id}`, bob)).status === 404,
  );
  check(
    "Alice's address is untouched",
    (await call('GET', '/account/addresses', alice)).body.data[0].city === 'Mardan',
  );

  section('Password');
  check(
    'wrong current password refused',
    (
      await call('POST', '/account/password', alice, {
        currentPassword: 'Wrong!123',
        newPassword: 'BrandNew!23',
      })
    ).status === 401,
  );
  check(
    'weak new password refused',
    (
      await call('POST', '/account/password', alice, {
        currentPassword: PW,
        newPassword: 'weak',
      })
    ).status >= 400,
  );
  check(
    'reusing the current password refused',
    (
      await call('POST', '/account/password', alice, {
        currentPassword: PW,
        newPassword: PW,
      })
    ).status === 400,
  );

  const NEW_PW = 'BrandNew!234';
  check(
    'password changes',
    (
      await call('POST', '/account/password', alice, {
        currentPassword: PW,
        newPassword: NEW_PW,
      })
    ).status === 200,
  );
  check(
    'the old password stops working',
    (await call('POST', '/auth/login', null, { email: aliceEmail, password: PW })).status === 401,
  );
  alice = await login(aliceEmail, NEW_PW);
  check('the new password works', Boolean(alice));

  section('Sessions');
  const sessions = await call('GET', '/account/sessions', alice);
  check('sessions listed', sessions.status === 200);
  check(
    'the current device is flagged',
    sessions.body.data.some((s) => s.isCurrent),
  );
  check(
    'full IP addresses are masked',
    sessions.body.data.every((s) => !s.ip || s.ip.includes('•')),
  );
  check('no token hashes leak', !JSON.stringify(sessions.body).includes('tokenHash'));

  await login(aliceEmail, NEW_PW);
  const revoked = await call('POST', '/account/sessions/revoke-others', alice);
  check(
    'other devices are signed out',
    revoked.status === 200 && revoked.body.data.removed >= 1,
    JSON.stringify(revoked.body.data),
  );
  const after = await call('GET', '/account/sessions', alice);
  check('only this device remains', after.body.data.length === 1 && after.body.data[0].isCurrent);

  section('Wishlist');
  const menu = await call('GET', '/catalog/products?limit=10', null);
  const [p1, p2] = menu.body.data ?? [];

  check('anonymous cannot save', (await call('POST', `/wishlist/toggle/${p1.id}`, null)).status === 401);

  const saved = await call('POST', `/wishlist/toggle/${p1.id}`, alice);
  check('a product can be saved', saved.body.data?.saved === true);
  check(
    'it appears with LIVE pricing',
    typeof (await call('GET', '/wishlist', alice)).body.data.items[0]?.effectivePrice === 'number',
    'a stale price would change under the customer at checkout',
  );

  check(
    'toggling again unsaves it',
    (await call('POST', `/wishlist/toggle/${p1.id}`, alice)).body.data.saved === false,
  );

  await call('POST', `/wishlist/toggle/${p1.id}`, alice);
  await call('DELETE', `/wishlist/${p1.id}`, alice);
  await call('POST', `/wishlist/toggle/${p1.id}`, alice);
  check(
    'repeated save/remove leaves no duplicates',
    (await call('GET', '/wishlist', alice)).body.data.items.filter((i) => i.id === p1.id).length === 1,
  );

  check(
    'removing something absent is not an error',
    (await call('DELETE', `/wishlist/${p2.id}`, alice)).status === 200,
  );

  await call('POST', `/wishlist/toggle/${p2.id}`, bob);
  check(
    'wishlists are isolated per customer',
    !(await call('GET', '/wishlist', alice)).body.data.items.some((i) => i.id === p2.id) &&
      !(await call('GET', '/wishlist', bob)).body.data.items.some((i) => i.id === p1.id),
  );

  return report();
}
