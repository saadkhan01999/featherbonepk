import { useMemo } from 'react';
import { CheckSquare, Eye, Square, Copy } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * Permission picker — per person or per role.
 * ---------------------------------------------------------------------------
 * Every permission, grouped by module, with the shortcuts an owner reaches for:
 *
 *   Select all     every permission you may grant
 *   View only      every ".view" permission — a read-only account
 *   Clear all      nothing
 *   Copy role…     start from another role's defaults, then adjust
 *   Group All/None one module at a time ("everything in Kitchen")
 *
 * A permission the signed-in person does not hold is shown but disabled: you
 * cannot hand out access you do not have, and the server refuses it anyway.
 * The shortcuts respect that — "Select all" selects what you can grant, and
 * never removes a permission you could not have added yourself.
 *
 * @param {object} props
 * @param {{module: string, permissions: string[]}[]} props.groups
 * @param {string[]} props.value selected permissions
 * @param {(next: string[]) => void} props.onChange
 * @param {(permission: string) => boolean} [props.canGrant]
 * @param {{value: string, label: string, defaultPermissions: string[]}[]} [props.roles]
 * @param {boolean} [props.disabled]
 */
export function PermissionMatrix({
  groups = [],
  value = [],
  onChange,
  canGrant = () => true,
  roles = [],
  disabled = false,
}) {
  const selected = useMemo(() => new Set(value), [value]);
  const all = useMemo(() => groups.flatMap((g) => g.permissions), [groups]);
  const grantable = useMemo(() => all.filter(canGrant), [all, canGrant]);

  // Keep what cannot be granted exactly as it was — neither added nor removed.
  const lockedSelected = value.filter((p) => !canGrant(p));
  const apply = (grantedPart) => onChange([...new Set([...lockedSelected, ...grantedPart.filter(canGrant)])]);

  const setGroup = (group, on) => {
    const inGroup = new Set(group.permissions.filter(canGrant));
    const rest = value.filter((p) => !inGroup.has(p));
    onChange(on ? [...new Set([...rest, ...inGroup])] : rest);
  };

  const toggle = (permission, on) =>
    onChange(on ? [...new Set([...value, permission])] : value.filter((p) => p !== permission));

  return (
    <div className="space-y-3">
      {/* --- Shortcuts --- */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Shortcut icon={CheckSquare} disabled={disabled} onClick={() => apply(grantable)}>
          Select all
        </Shortcut>
        <Shortcut
          icon={Eye}
          disabled={disabled}
          onClick={() => apply(grantable.filter((p) => p.endsWith('.view')))}
        >
          View only
        </Shortcut>
        <Shortcut icon={Square} disabled={disabled} onClick={() => apply([])}>
          Clear all
        </Shortcut>
        {roles.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            <select
              value=""
              disabled={disabled}
              onChange={(e) => {
                const role = roles.find((r) => r.value === e.target.value);
                if (role) apply(role.defaultPermissions ?? []);
              }}
              aria-label="Copy another role's permissions"
              className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs focus:border-gold focus:outline-none"
            >
              <option value="">Copy a role…</option>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length} of {all.length} permissions selected
        {grantable.length < all.length &&
          ` · ${all.length - grantable.length} greyed out: you do not hold them`}
      </p>

      {/* --- Groups --- */}
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => {
          const count = group.permissions.filter((p) => selected.has(p)).length;
          const grantableInGroup = group.permissions.filter(canGrant);
          const allOn = grantableInGroup.length > 0 && grantableInGroup.every((p) => selected.has(p));
          return (
            <fieldset key={group.module} className="rounded-xl border border-border bg-surface/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <legend className="text-[11px] font-semibold uppercase tracking-wider text-gold">
                  {group.module}{' '}
                  <span className="font-normal text-muted-foreground">
                    {count}/{group.permissions.length}
                  </span>
                </legend>
                {grantableInGroup.length > 0 && !disabled && (
                  <button
                    type="button"
                    onClick={() => setGroup(group, !allOn)}
                    className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  >
                    {allOn ? 'None' : 'All'}
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {group.permissions.map((permission) => {
                  const allowed = canGrant(permission);
                  const [, action = permission] = permission.split('.');
                  return (
                    <label
                      key={permission}
                      title={allowed ? permission : `${permission} — you do not hold this permission`}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-hover',
                        (!allowed || disabled) && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(permission)}
                        disabled={!allowed || disabled}
                        onChange={(e) => toggle(permission, e.target.checked)}
                        className="h-4 w-4 rounded accent-gold"
                      />
                      <span className="capitalize">{action.replace(/_/g, ' ')}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

function Shortcut({ icon: Icon, children, ...props }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-gold/50 hover:text-foreground disabled:opacity-50"
      {...props}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

export default PermissionMatrix;
