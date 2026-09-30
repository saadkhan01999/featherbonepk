/**
 * RBAC: staff guards, till access, and the permission-scoped dashboard.
 *
 * This is the most security-sensitive suite in the project. Every assertion
 * here is something that, if it broke, would let someone see or do more than
 * they should — quietly.
 */
import { OWNER_EMAIL, call, login, posLogin, suite, PW, uniqueEmail, uniquePhone } from './harness.mjs';

export default async function run() {
  const { check, section, report } = suite('rbac');

  const superToken = await login(OWNER_EMAIL);
  const adminToken = await login('admin@featherandbone.dev');
  const cashierToken = await login('cashier@featherandbone.dev');

  section('Permissions travel with the user');
  const su = await call('GET', '/auth/me', superToken);
  check('/auth/me returns the user unwrapped', Boolean(su.body.data?.email));
  check('super admin holds the wildcard', su.body.data?.permissions?.includes('*'));

  const cashierMe = await call('GET', '/auth/me', cashierToken);
  check(
    'a cashier holds an explicit list, not the wildcard',
    Array.isArray(cashierMe.body.data.permissions) && !cashierMe.body.data.permissions.includes('*'),
  );

  section('Privilege escalation guards');
  check(
    'admin CANNOT create a super admin',
    (
      await call('POST', '/staff', adminToken, {
        fullName: 'Escalation',
        email: uniqueEmail('esc'),
        password: PW,
        role: 'super_admin',
        phone: uniquePhone('0361'),
      })
    ).status === 403,
  );

  check(
    'admin CANNOT create a peer admin',
    (
      await call('POST', '/staff', adminToken, {
        fullName: 'Peer',
        email: uniqueEmail('peer'),
        password: PW,
        role: 'admin',
        phone: uniquePhone('0362'),
      })
    ).status === 403,
  );

  check(
    'admin CANNOT grant a permission they do not hold',
    (
      await call('POST', '/staff', adminToken, {
        fullName: 'Overreach',
        email: uniqueEmail('over'),
        password: PW,
        role: 'cashier',
        phone: uniquePhone('0363'),
        permissions: ['role.manage'],
      })
    ).status === 403,
  );

  section('Till access is a PERMISSION, not a role');
  check('super admin can open a till', (await posLogin(OWNER_EMAIL)).status === 200);
  check('cashier can open a till', (await posLogin('cashier@featherandbone.dev')).status === 200);
  check('a rider (no pos.operate) CANNOT', (await posLogin('rider@featherandbone.dev')).status === 403);

  const custEmail = uniqueEmail('till');
  await call('POST', '/auth/register', null, {
    fullName: 'Curious Customer',
    email: custEmail,
    phone: uniquePhone('0364'),
    password: PW,
  });
  check('a customer can never open a till', (await posLogin(custEmail)).status === 403);

  section('Revoking till access from a manager');
  const mgrEmail = uniqueEmail('tillmgr');
  const made = await call('POST', '/staff', superToken, {
    fullName: 'Till Manager',
    email: mgrEmail,
    password: PW,
    role: 'manager',
    phone: uniquePhone('0365'),
  });
  check('manager created', made.status === 201, JSON.stringify(made.body).slice(0, 140));
  const mgrId = made.body.data?.id;

  check('they can open a till by default', (await posLogin(mgrEmail)).status === 200);

  await call('PATCH', `/staff/${mgrId}`, superToken, {
    permissions: ['product.view', 'order.view', 'category.view'],
  });
  check(
    'REVOKED account cannot open a till',
    (await posLogin(mgrEmail)).status === 403,
    'this is the whole point of gating on permission rather than role',
  );
  check(
    'but can still sign into the back office',
    (await call('POST', '/auth/login', null, { email: mgrEmail, password: PW })).status === 200,
  );

  section('Permission-scoped dashboard');
  const scopedToken = await login(mgrEmail);
  const scoped = await call('GET', '/dashboard/overview', scopedToken);

  check(
    'the landing page LOADS rather than 403ing',
    scoped.status === 200,
    `got ${scoped.status} — a back office whose front door errors is a bug, not a permission model`,
  );
  check('revenue section absent', scoped.body.data.sections.revenue === false);
  check('people section absent', scoped.body.data.sections.people === false);
  check(
    'NO revenue figures are sent at all',
    scoped.body.data.revenue === null,
    'hiding the panel client-side would still ship the numbers over the wire',
  );
  check('no top sellers sent', scoped.body.data.topSellers === null);
  check('no payment breakdown sent', scoped.body.data.byMethod === null);

  section('Routes stay enforced regardless of the nav');
  check(
    'cannot read reports',
    (await call('GET', '/reports/sales-summary?preset=today', scopedToken)).status === 403,
  );
  check('cannot list staff', (await call('GET', '/staff', scopedToken)).status === 403);
  check('cannot list customers', (await call('GET', '/customers', scopedToken)).status === 403);
  check(
    'cannot manage terminals',
    (await call('POST', '/terminals', scopedToken, { code: 'TILL-X', name: 'Nope' })).status === 403,
  );

  section('Grants take effect immediately');
  await call('PATCH', `/staff/${mgrId}`, superToken, {
    permissions: ['product.view', 'order.view', 'category.view', 'report.view', 'inventory.view'],
  });
  const afterGrant = await call('GET', '/dashboard/overview', scopedToken);
  check(
    'revenue appears on the SAME token',
    afterGrant.body.data.sections.revenue === true,
    'permissions are read per request, so no re-login is needed',
  );

  section('Deactivation');
  await call('PATCH', `/staff/${mgrId}`, superToken, { status: 'inactive' });
  check('an inactive account is refused at the till', (await posLogin(mgrEmail)).status === 403);
  check(
    'and refused on the website',
    (await call('POST', '/auth/login', null, { email: mgrEmail, password: PW })).status === 403,
  );
  check(
    'the record is retained, not deleted',
    (await call('GET', '/staff', superToken)).body.data.some((u) => u.id === mgrId),
    'history references it',
  );

  // --- The whole point of "only the super admin is seeded" -----------------
  section('The owner hires someone, and they can sign in');

  /*
   * The seed creates one account. Everybody else exists because the owner
   * created them — so "the owner sets an email and password, and that person
   * can then sign in on both surfaces" is not a nice-to-have, it is the only
   * way anyone but the owner ever reaches the system.
   */
  const hireEmail = uniqueEmail('newhire');
  const hirePassword = 'Bakery@2026';

  const hired = await call('POST', '/staff', superToken, {
    fullName: 'New Cashier',
    email: hireEmail,
    password: hirePassword,
    phone: uniquePhone(),
    role: 'cashier',
  });
  check('the owner can create a cashier', hired.status === 201, `status ${hired.status}`);

  // Online — the back office, with the password the owner chose.
  const hireWeb = await call('POST', '/auth/login', null, {
    email: hireEmail,
    password: hirePassword,
  });
  check('they sign in ONLINE with those credentials', hireWeb.status === 200, `status ${hireWeb.status}`);
  check(
    'and receive only a cashier’s modules',
    hireWeb.body.data?.user?.permissions?.includes('pos.operate') &&
      !hireWeb.body.data?.user?.permissions?.includes('employee.manage'),
  );

  // At the till — same email, same password, plus the till code.
  const hireTill = await posLogin(hireEmail, 'TILL-01', hirePassword);
  check(
    'they sign in AT THE TILL with the same credentials',
    hireTill.status === 200,
    `status ${hireTill.status}`,
  );

  // A wrong password must fail on both surfaces, not just the website.
  const badWeb = await call('POST', '/auth/login', null, {
    email: hireEmail,
    password: 'Wrong@1234',
  });
  const badTill = await posLogin(hireEmail, 'TILL-01', 'Wrong@1234');
  check('a wrong password is refused online', badWeb.status === 401, `status ${badWeb.status}`);
  check('a wrong password is refused at the till', badTill.status === 401, `status ${badTill.status}`);

  // Deactivating must shut both doors. Closing only the website would leave a
  // dismissed cashier able to keep ringing up sales.
  await call('PATCH', `/staff/${hired.body.data?.id}`, superToken, { status: 'inactive' });
  const goneWeb = await call('POST', '/auth/login', null, {
    email: hireEmail,
    password: hirePassword,
  });
  const goneTill = await posLogin(hireEmail, 'TILL-01', hirePassword);
  check('deactivating locks them out online', goneWeb.status === 403, `status ${goneWeb.status}`);
  check('and out of the till too', goneTill.status === 403, `status ${goneTill.status}`);

  return report();
}
