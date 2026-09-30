import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  UserPlus,
  Shield,
  Users,
  UserCheck,
  Pencil,
  Ban,
  KeyRound,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { StatTile } from '@/components/ui/StatTile.jsx';
import { Input, PasswordInput, Select } from '@/components/ui/Input.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { formatRelativeTime } from '@/lib/format.js';
import { staggerContainer } from '@/lib/motion.js';
import { getInitials, cn } from '@/lib/utils.js';
import { PermissionMatrix } from '@/components/admin/PermissionMatrix.jsx';

/**
 * User & Role Management — screen 09 in the reference design.
 * ---------------------------------------------------------------------------
 * Staff list with roles and active state, plus a permission matrix.
 *
 * The matrix disables any permission the current user does not hold themselves.
 * The server enforces the same rule, but showing an unusable checkbox and then
 * rejecting the save teaches people the UI lies to them. Disabled-with-a-reason
 * is the honest version.
 */

const ROLE_TONE = {
  super_admin: 'gold',
  admin: 'info',
  manager: 'info',
  cashier: 'success',
  kitchen: 'warning',
  rider: 'default',
};

const STATUS_TONE = { active: 'success', inactive: 'default', suspended: 'destructive' };

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
  role: 'cashier',
  permissions: null,
};

export function StaffPage() {
  const { user: me } = useAuth();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | staff object
  const [form, setForm] = useState(EMPTY_FORM);
  const [deactivating, setDeactivating] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  /**
   * Password reset, in two steps.
   *
   * `resetting` is the employee whose password is about to be replaced;
   * `resetResult` is the one-time password that came back. They are separate
   * because the second dialog must survive the first one closing, and because
   * `resetResult` existing is precisely the condition for "there is a secret on
   * screen right now" — which is what the copy-and-dismiss flow hangs off.
   */
  const [resetting, setResetting] = useState(null);
  const [resetChoice, setResetChoice] = useState({ mode: 'generate', password: '' });
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const { data: catalogue } = useResource(() => apiClient.get('/staff/catalogue'), []);
  const {
    rows: staffRows,
    meta,
    isLoading,
    error,
    reload,
    goToPage,
  } = usePagedResource(
    ({ page, limit }) =>
      apiClient.get('/staff', {
        params: { page, limit, ...(roleFilter && { role: roleFilter }) },
        _wantEnvelope: true,
      }),
    [roleFilter],
  );
  const { data: stats } = useResource(() => apiClient.get('/staff/stats'), []);

  const flash = useCallback((type, message) => {
    setNotice({ type, message });
    window.clearTimeout(flash.timer);
    flash.timer = window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const rows = useMemo(() => {
    const list = staffRows;
    if (!search.trim()) return list;
    const term = search.trim().toLowerCase();
    return list.filter(
      (u) =>
        u.fullName.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        u.phone?.includes(term) ||
        u.roleLabel.toLowerCase().includes(term),
    );
  }, [staffRows, search]);

  /**
   * What the current user is allowed to grant. Super admin holds everything.
   *
   * Read from the auth context, not by searching the staff list. The list is a
   * page of results, so an admin who happened to fall outside it found no match
   * and got an empty permission set — which reads as "you may grant nothing" and
   * makes the whole matrix look broken. `/auth/me` returns the signed-in
   * account's permissions directly and cannot be paged out of existence.
   */
  const myPermissions = useMemo(() => {
    if (me?.role === 'super_admin') return null; // null = unrestricted
    return me?.permissions ?? [];
  }, [me]);

  const canGrant = useCallback(
    (permission) => myPermissions === null || myPermissions.includes(permission),
    [myPermissions],
  );

  function openNew() {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(member) {
    setForm({
      fullName: member.fullName,
      email: member.email,
      phone: member.phone ?? '',
      password: '',
      role: member.role,
      // null means "inherit the role defaults"; an array means custom grants.
      permissions: member.hasCustomPermissions ? [...member.permissions] : null,
    });
    setFieldErrors({});
    setEditing(member);
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});

    try {
      if (editing === 'new') {
        await apiClient.post('/staff', {
          fullName: form.fullName,
          email: form.email,
          ...(form.phone && { phone: form.phone }),
          password: form.password,
          role: form.role,
          ...(form.permissions && { permissions: form.permissions }),
        });
        flash('success', `${form.fullName} added as ${labelFor(form.role)}`);
      } else {
        await apiClient.patch(`/staff/${editing.id}`, {
          fullName: form.fullName,
          phone: form.phone,
          role: form.role,
          ...(form.permissions && { permissions: form.permissions }),
        });
        flash('success', `${form.fullName} updated`);
      }
      setEditing(null);
      reload();
    } catch (err) {
      if (Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      }
      flash('error', err.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  function openReset(member) {
    setResetChoice({ mode: 'generate', password: '' });
    setFieldErrors({});
    setResetting(member);
  }

  /**
   * Replace an employee's password and show the new one once.
   *
   * The response is the only time this value exists in readable form — the
   * server hashed it before replying and keeps no copy, so there is no endpoint
   * that could hand it back if this dialog is dismissed too early. That is why
   * the result opens its own dialog rather than a toast that times out.
   */
  async function confirmReset() {
    setSaving(true);
    setFieldErrors({});

    try {
      const result = await apiClient.post(`/staff/${resetting.id}/reset-password`, {
        // Omitted entirely when generating — sending an empty string would fail
        // the password policy the server applies to any value it is given.
        ...(resetChoice.mode === 'manual' && { password: resetChoice.password }),
      });
      setResetting(null);
      setCopied(false);
      setResetResult(result);
      reload();
    } catch (err) {
      if (Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      }
      flash('error', err.message ?? 'Could not reset the password');
    } finally {
      setSaving(false);
    }
  }

  async function copyTemporaryPassword() {
    try {
      await navigator.clipboard.writeText(resetResult.temporaryPassword);
      setCopied(true);
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // embedded browsers. The password is on screen and selectable, so this is
      // a convenience that failed — not something worth interrupting them for.
      setCopied(false);
    }
  }

  async function confirmDeactivate() {
    try {
      const result = await apiClient.delete(`/staff/${deactivating.id}`);
      flash('success', result.message ?? 'Employee deactivated');
      reload();
    } catch (err) {
      flash('error', err.message ?? 'Could not deactivate');
    } finally {
      setDeactivating(null);
    }
  }

  function labelFor(role) {
    return catalogue?.roles.find((r) => r.value === role)?.label ?? role;
  }

  /** Roles this user may assign — the UI mirror of the server's rank guard. */
  const assignableRoles = useMemo(() => {
    const all = catalogue?.roles ?? [];
    if (me?.role === 'super_admin') return all;
    const myRank = all.find((r) => r.value === me?.role)?.rank ?? 0;
    return all.filter((r) => r.rank < myRank);
  }, [catalogue, me]);

  if (isLoading) return <SectionLoader label="Loading staff" />;
  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
        {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User &amp; Role Management</h1>
          <p className="text-sm text-muted-foreground">
            Staff accounts, roles and what each person is allowed to do.
          </p>
        </div>
        <Button leftIcon={UserPlus} onClick={openNew}>
          Add New User
        </Button>
      </header>

      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
            notice.type === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-success/40 bg-success/10 text-success',
          )}
        >
          {notice.type === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.message}</span>
        </motion.div>
      )}

      {/* --- Summary --- */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid gap-4 sm:grid-cols-3"
      >
        <StatTile icon={Users} label="Total Staff" value={stats?.total ?? 0} />
        <StatTile icon={UserCheck} label="Active" value={stats?.active ?? 0} tone="success" />
        <StatTile icon={Shield} label="Roles in Use" value={Object.keys(stats?.byRole ?? {}).length} />
      </motion.div>

      {/* --- Controls --- */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone or role…"
          label="Search staff"
        />

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">All roles</option>
          {catalogue?.roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </div>

      {/* --- Table --- */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Staff accounts and their roles</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Last Active</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {rows.map((member) => {
                const isMe = member.id === me?.id;
                return (
                  <tr key={member.id} className="transition-colors hover:bg-surface-hover">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-gradient text-xs font-bold text-gold-foreground">
                          {getInitials(member.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {member.fullName}
                            {isMe && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <Badge variant={ROLE_TONE[member.role] ?? 'default'} size="sm">
                        {member.roleLabel}
                      </Badge>
                      {member.hasCustomPermissions && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">custom</span>
                      )}
                      {/* So the owner can see at a glance who is still on a
                          temporary password and has not yet chosen their own. */}
                      {member.mustChangePassword && (
                        <span className="ml-1.5 text-[10px] text-warning">temp password</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-muted-foreground">
                      {member.lastLoginAt ? formatRelativeTime(member.lastLoginAt) : 'Never'}
                    </td>

                    <td className="px-3 py-2.5 text-center">
                      <Badge variant={STATUS_TONE[member.status] ?? 'default'} size="sm" dot>
                        {member.status}
                      </Badge>
                    </td>

                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(member)}
                          disabled={isMe}
                          aria-label={`Edit ${member.fullName}`}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-gold disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openReset(member)}
                          // Resetting your own password here would sign you out
                          // of the screen you are standing on; the account menu
                          // is the right place for that. Blocked server-side too.
                          disabled={isMe}
                          aria-label={`Reset password for ${member.fullName}`}
                          title="Reset password"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-gold disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeactivating(member)}
                          // Self-deactivation is blocked server-side too; the
                          // disabled state just avoids a pointless round trip.
                          disabled={isMe || member.status !== 'active'}
                          aria-label={`Deactivate ${member.fullName}`}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* BUG-32: a search that matches nothing said nothing at all. */}
        {rows.length === 0 && (
          <EmptyState
            icon={Users}
            title={search ? 'No staff match that search' : 'No staff yet'}
            body={
              search
                ? 'Try a name, email, phone number or role.'
                : 'Create accounts for the people who work here — they sign in at /admin/login.'
            }
            action={
              search ? (
                <Button variant="outline" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : null
            }
          />
        )}

        {/* `filtered` so the count matches the rows after the local search. */}
        <div className="px-5 pb-4">
          <Pagination meta={meta} onPageChange={goToPage} label="staff" filtered={rows.length} />
        </div>
      </section>

      {/* --- Add / edit --- */}
      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add New User' : `Edit ${editing?.fullName ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={save} isLoading={isSaving} loadingText="Saving…">
              {editing === 'new' ? 'Create User' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Full Name"
              value={form.fullName}
              onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
              error={fieldErrors.fullName}
              required
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              error={fieldErrors.email}
              // Email identifies the account; changing it would orphan sessions
              // and audit records, so it is set once at creation.
              disabled={editing !== 'new'}
              hint={editing !== 'new' ? 'Email cannot be changed' : undefined}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Phone"
              placeholder="03XX XXXXXXX"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              error={fieldErrors.phone}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value, permissions: null }))}
              error={fieldErrors.role}
            >
              {assignableRoles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </Select>
          </div>

          {editing === 'new' && (
            <PasswordInput
              label="Temporary Password"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              error={fieldErrors.password}
              hint="At least 8 characters, using three of: lowercase, uppercase, a number, a symbol. They choose their own after signing in."
            />
          )}

          {/* --- Permission matrix --- */}
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Permissions</p>
                <p className="text-xs text-muted-foreground">
                  {form.permissions === null
                    ? `Using the default grants for ${labelFor(form.role)}.`
                    : 'Custom grants for this person.'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    permissions:
                      p.permissions === null
                        ? [...(catalogue?.roles.find((r) => r.value === p.role)?.defaultPermissions ?? [])]
                        : null,
                  }))
                }
              >
                {form.permissions === null ? 'Customise' : 'Use role defaults'}
              </Button>
            </div>

            {form.permissions !== null && (
              <div className="mt-4 max-h-[50vh] overflow-y-auto pr-1">
                <PermissionMatrix
                  groups={catalogue?.permissionGroups ?? []}
                  roles={catalogue?.roles ?? []}
                  value={form.permissions}
                  canGrant={canGrant}
                  onChange={(permissions) => setForm((p) => ({ ...p, permissions }))}
                />
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={confirmDeactivate}
        title={`Deactivate ${deactivating?.fullName}?`}
        message="They will be signed out immediately and cannot sign in again. The account is kept, not deleted, because orders and shifts reference it."
        confirmLabel="Deactivate"
      />

      {/* --- Password reset, step 1: choose how ----------------------------- */}
      <ConfirmDialog
        isOpen={Boolean(resetting)}
        onClose={() => setResetting(null)}
        onConfirm={confirmReset}
        isLoading={isSaving}
        // Not `destructive`: nothing is lost here. The account keeps its
        // history and its shifts — only the credential changes.
        variant="primary"
        title={`Reset password for ${resetting?.fullName}?`}
        message={
          `${resetting?.fullName} will be signed out of the website and every till, and must choose a new ` +
          'password before they can work again. Their current password cannot be shown — it is stored only as ' +
          'a hash, so this replaces it.'
        }
        confirmLabel="Reset password"
      >
        <div className="mt-4 space-y-3">
          <Select
            label="New password"
            value={resetChoice.mode}
            onChange={(e) => setResetChoice((c) => ({ ...c, mode: e.target.value }))}
          >
            <option value="generate">Generate a secure temporary password</option>
            <option value="manual">Set one myself</option>
          </Select>

          {resetChoice.mode === 'manual' && (
            <PasswordInput
              label="Temporary password"
              value={resetChoice.password}
              onChange={(e) => setResetChoice((c) => ({ ...c, password: e.target.value }))}
              error={fieldErrors.password}
              autoComplete="new-password"
              hint="At least 8 characters, using three of: lowercase, uppercase, a number, a symbol."
            />
          )}
        </div>
      </ConfirmDialog>

      {/* --- Password reset, step 2: the one and only sighting -------------- */}
      <Modal
        isOpen={Boolean(resetResult)}
        onClose={() => setResetResult(null)}
        title="Temporary password"
        size="sm"
        // Dismissing by accident loses the password for good, so the backdrop
        // and Escape are disabled: closing has to be a decision.
        closeOnBackdrop={false}
        closeOnEscape={false}
        showCloseButton={false}
        footer={
          <>
            <Button variant="ghost" onClick={copyTemporaryPassword}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button onClick={() => setResetResult(null)}>Done — I have saved it</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Give this to <span className="font-medium text-foreground">{resetResult?.fullName}</span> (
            {resetResult?.email}). They sign in with it on the website and are asked to choose their own
            password straight away.
          </p>

          <p
            className="select-all break-all rounded-lg border border-border bg-surface-raised px-4 py-3 text-center font-mono text-base font-semibold tracking-tight"
            // Announced so the value is available to a screen reader the moment
            // it appears — there is no second chance to go back and read it.
            role="status"
          >
            {resetResult?.temporaryPassword}
          </p>

          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Shown once. It is stored only as a hash, so nobody — including you — can look it up again. If it
              is lost, run another reset.
            </span>
          </p>
        </div>
      </Modal>
    </div>
  );
}

export default StaffPage;
