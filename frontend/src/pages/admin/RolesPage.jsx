import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, ShieldCheck, Users, Info } from 'lucide-react';

import { Badge } from '@/components/ui/Badge.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { ROUTES } from '@/constants/routes.js';

/**
 * Roles & Permissions.
 * ---------------------------------------------------------------------------
 * Answers one question the Users screen cannot: **what does a Manager actually
 * get?**
 *
 * Users is about people — hire someone, set their password, tick the extra
 * permissions they personally need. This is about the system: every role beside
 * every permission, so the owner can see the shape of their access model
 * without opening six staff records and comparing them by memory.
 *
 * Role defaults are defined in code, not editable here — and that is stated on
 * the page rather than implied by a missing button. They are a security
 * boundary: an editable "admin" role is one careless click from granting
 * everyone everything. Per-person exceptions belong on the person, where they
 * are visible next to the name of whoever holds them.
 */

export function RolesPage() {
  const [search, setSearch] = useState('');
  const { data: catalogue, isLoading, error } = useResource(() => apiClient.get('/staff/catalogue'), []);
  // Headcount per role, so the matrix shows which roles are actually in use.
  const { data: stats } = useResource(() => apiClient.get('/staff/stats').catch(() => null), []);

  const groups = useMemo(() => {
    // The API sends `{ module, permissions: ['product.manage', …] }` — plain
    // strings, grouped by module. No per-permission labels exist server-side,
    // so the action half of the key is humanised below.
    const all = catalogue?.permissionGroups ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;

    return all
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter(
          (key) => key.toLowerCase().includes(term) || group.module.toLowerCase().includes(term),
        ),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [catalogue, search]);

  if (isLoading) return <SectionLoader label="Loading roles" />;
  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
        {error.message ?? 'Could not load the permission catalogue.'}
      </div>
    );
  }

  const roles = catalogue?.roles ?? [];

  /**
   * "product.manage" -> "Manage".
   * The module is already the row group's heading, so repeating it on every
   * row would just make the column wider without saying anything.
   */
  const actionLabel = (key) =>
    (key.split('.')[1] ?? key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  /** Does this role hold this permission by default? */
  const holds = (role, permission) =>
    // Super admin is the wildcard: it bypasses the list entirely rather than
    // enumerating every permission, so a new permission is covered the moment
    // it is added.
    role.isSystem || (role.defaultPermissions ?? []).includes(permission);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
        <p className="text-sm text-muted-foreground">
          What each role can do out of the box. To give one person something extra, edit them in{' '}
          <Link to={ROUTES.ADMIN_USERS} className="text-gold underline">
            User Management
          </Link>
          .
        </p>
      </header>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
        <p>
          These defaults are part of the application, not settings — an editable “admin” role would be one
          click away from granting everyone everything. Individual exceptions are set per person, where they
          stay visible next to the name of whoever holds them.
        </p>
      </div>

      {/* --- Role summary --- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => {
          const count = stats?.byRole?.[role.value]?.total ?? 0;
          const active = stats?.byRole?.[role.value]?.active ?? 0;

          return (
            <article
              key={role.value}
              className="rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-gold/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold">
                    <ShieldCheck className="h-4 w-4 text-gold" aria-hidden="true" />
                    {role.label}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {role.isSystem
                      ? 'Every permission, including any added later'
                      : `${role.defaultPermissions?.length ?? 0} permissions`}
                  </p>
                </div>
                {role.isSystem && (
                  <Badge variant="gold" size="sm">
                    Full access
                  </Badge>
                )}
              </div>

              <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {count === 0 ? (
                  'Nobody holds this role'
                ) : (
                  <>
                    <span className="font-medium text-foreground">{count}</span>
                    {count === 1 ? ' person' : ' people'}
                    {active !== count && ` · ${active} active`}
                  </>
                )}
              </p>
            </article>
          );
        })}
      </div>

      {/* --- The matrix --- */}
      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="font-semibold">Permission Matrix</h2>
          <SearchInput
            className="min-w-[220px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a permission…"
            label="Search permissions"
          />
        </div>

        {groups.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            No permission matches “{search}”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="sticky left-0 bg-surface px-5 py-2.5 text-left font-medium">Permission</th>
                  {roles.map((role) => (
                    <th key={role.value} className="px-3 py-2.5 text-center font-medium">
                      {role.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {groups.map((group) => (
                  // A Fragment, not a wrapper element: <tr> cannot legally
                  // contain another <tr>, and browsers silently hoist the
                  // inner rows out, wrecking the column alignment.
                  <Fragment key={group.module}>
                    <tr className="bg-surface-hover/60">
                      <th
                        colSpan={roles.length + 1}
                        scope="colgroup"
                        className="px-5 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gold"
                      >
                        {group.module}
                      </th>
                    </tr>

                    {group.permissions.map((permission) => (
                      <tr key={permission} className="hover:bg-surface-hover">
                        <th scope="row" className="sticky left-0 bg-surface px-5 py-2 text-left font-normal">
                          <span className="block">{actionLabel(permission)}</span>
                          <code className="text-xs text-muted-foreground">{permission}</code>
                        </th>

                        {roles.map((role) => (
                          <td key={role.value} className="px-3 py-2 text-center">
                            {holds(role, permission) ? (
                              <Check
                                className="mx-auto h-4 w-4 text-success"
                                aria-label={`${role.label}: allowed`}
                              />
                            ) : (
                              <Minus
                                className="mx-auto h-4 w-4 text-muted-foreground/30"
                                aria-label={`${role.label}: not allowed`}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default RolesPage;
