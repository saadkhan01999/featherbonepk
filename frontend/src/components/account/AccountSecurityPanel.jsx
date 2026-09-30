import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  KeyRound,
  Monitor,
  LogOut,
  AlertCircle,
  CheckCircle2,
  User as UserIcon,
  AtSign,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Input, PasswordInput } from '@/components/ui/Input.jsx';
import { ConfirmDialog } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { checkPassword, passwordChecklist } from '@/lib/passwordRules.js';
import { formatRelativeTime } from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Your details, password, sign-in email and devices.
 * ---------------------------------------------------------------------------
 * One implementation for everybody: a customer at /account/security and the
 * owner or a manager at /admin/profile see the same forms against the same
 * endpoints (`/account`, `/account/password`, `/account/email`,
 * `/account/sessions`).
 *
 * The password checklist is the shared policy (lib/passwordRules.js, which
 * mirrors the server): 8+ characters and any three of lower/upper/number/symbol.
 *
 * Changing the email needs the current password: whoever controls the address
 * can reset the password, so a borrowed session must not be enough to move it.
 */
export function AccountSecurityPanel() {
  const { user, refreshUser } = useAuth();

  const [profile, setProfile] = useState(null);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [emailForm, setEmailForm] = useState({ newEmail: '', currentPassword: '' });
  const [isSavingProfile, setSavingProfile] = useState(false);
  const [isSavingPassword, setSavingPassword] = useState(false);
  const [isSavingEmail, setSavingEmail] = useState(false);
  const [isRevoking, setRevoking] = useState(false);
  const [isSendingVerification, setSendingVerification] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const {
    data: account,
    isLoading,
    reload,
  } = useResource(
    () =>
      apiClient.get('/account').then((data) => {
        setProfile({ fullName: data.fullName ?? '', phone: data.phone ?? '' });
        return data;
      }),
    [],
  );

  const { data: sessions, reload: reloadSessions } = useResource(
    () => apiClient.get('/account/sessions'),
    [],
  );

  const fail = (err, fallback) => {
    if (err.details?.length) {
      setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
    } else {
      setNotice({ type: 'error', text: err.message ?? fallback });
    }
  };

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setFieldErrors({});
    try {
      // An empty phone is "not given", not an invalid number.
      await apiClient.patch('/account', {
        fullName: profile.fullName,
        ...(profile.phone.trim() && { phone: profile.phone }),
      });
      setNotice({ type: 'success', text: 'Profile updated' });
      reload();
      refreshUser?.();
    } catch (err) {
      fail(err, 'Could not update your profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setSavingPassword(true);
    setFieldErrors({});
    try {
      const result = await apiClient.post('/account/password', {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      setNotice({ type: 'success', text: result.message });
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
      reloadSessions();
      // Releases a forced change: the context copy of the user still says true.
      refreshUser?.();
    } catch (err) {
      fail(err, 'Could not change your password');
    } finally {
      setSavingPassword(false);
    }
  }

  async function changeEmail(event) {
    event.preventDefault();
    setSavingEmail(true);
    setFieldErrors({});
    try {
      const result = await apiClient.post('/account/email', emailForm);
      setNotice({ type: 'success', text: result.message });
      setEmailForm({ newEmail: '', currentPassword: '' });
      reload();
      reloadSessions();
      refreshUser?.();
    } catch (err) {
      fail(err, 'Could not change your email');
    } finally {
      setSavingEmail(false);
    }
  }

  async function sendVerification() {
    setSendingVerification(true);
    try {
      const result = await apiClient.post('/auth/resend-verification');
      setNotice({ type: 'success', text: result?.message ?? 'Verification email sent. Check your inbox.' });
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not send the verification email' });
    } finally {
      setSendingVerification(false);
    }
  }

  async function revokeOthers() {
    try {
      const result = await apiClient.post('/account/sessions/revoke-others');
      setNotice({ type: 'success', text: result.message });
      reloadSessions();
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not sign other devices out' });
    } finally {
      setRevoking(false);
    }
  }

  if (isLoading || !profile) return <SectionLoader label="Loading your details" />;

  const otherSessions = (sessions ?? []).filter((s) => !s.isCurrent);
  const checklist = passwordChecklist(passwords.newPassword);
  const passwordOk = checkPassword(passwords.newPassword).ok;
  const confirmMismatch = passwords.confirm !== '' && passwords.confirm !== passwords.newPassword;

  return (
    <div className="space-y-5">
      {notice && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
            notice.type === 'success'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Why someone was sent here straight after signing in. */}
      {user?.mustChangePassword && (
        <div
          className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Your password was reset by an administrator. Choose a new one below before you can use the rest of
            the system or sign in at a till.
          </span>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* --- Password: first, because it is why most people open this page --- */}
        <section className="rounded-2xl border border-border bg-surface">
          <SectionHeader icon={KeyRound} title="Change password" />
          <form onSubmit={changePassword} className="space-y-3.5 p-5">
            <PasswordInput
              label="Current password"
              required
              autoComplete="current-password"
              value={passwords.currentPassword}
              error={fieldErrors.currentPassword}
              onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
            />
            <PasswordInput
              label="New password"
              required
              autoComplete="new-password"
              value={passwords.newPassword}
              error={fieldErrors.newPassword}
              onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
            />
            <PasswordInput
              label="Confirm new password"
              required
              autoComplete="new-password"
              value={passwords.confirm}
              error={confirmMismatch ? 'The two passwords do not match' : undefined}
              onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
            />

            {passwords.newPassword && (
              <motion.ul {...staggerContainer} className="space-y-1">
                {checklist.map((rule) => (
                  <motion.li
                    {...staggerItem}
                    key={rule.key}
                    className={cn(
                      'flex items-center gap-1.5 text-xs',
                      rule.met ? 'text-success' : 'text-muted-foreground',
                    )}
                  >
                    <CheckCircle2 className={cn('h-3 w-3', !rule.met && 'opacity-30')} aria-hidden="true" />
                    {rule.label}
                  </motion.li>
                ))}
              </motion.ul>
            )}

            <p className="text-xs text-muted-foreground">
              Changing your password signs out every other device.
            </p>

            <Button
              type="submit"
              leftIcon={KeyRound}
              isLoading={isSavingPassword}
              loadingText="Changing…"
              disabled={
                !passwords.currentPassword || !passwordOk || passwords.confirm !== passwords.newPassword
              }
            >
              Change password
            </Button>
          </form>
        </section>

        {/* --- Details --- */}
        <section className="rounded-2xl border border-border bg-surface">
          <SectionHeader icon={UserIcon} title="Your details" />
          <form onSubmit={saveProfile} className="space-y-3.5 p-5">
            <Input
              label="Full name"
              value={profile.fullName}
              error={fieldErrors.fullName}
              onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
            />
            <Input
              label="Mobile number"
              value={profile.phone}
              placeholder="03XXXXXXXXX"
              error={fieldErrors.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Signed in as</span>
              <span className="font-medium">{account.email}</span>
              {account.emailVerified ? (
                <Badge variant="success" size="sm" icon={CheckCircle2}>
                  Verified
                </Badge>
              ) : (
                <>
                  <Badge variant="warning" size="sm" icon={AlertCircle}>
                    Not verified
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    isLoading={isSendingVerification}
                    onClick={sendVerification}
                    className="text-gold"
                  >
                    Send verification email
                  </Button>
                </>
              )}
            </div>
            {account.memberSince && (
              <p className="text-xs text-muted-foreground">
                Member since{' '}
                {new Date(account.memberSince).toLocaleDateString('en-PK', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            )}
            <Button type="submit" isLoading={isSavingProfile} loadingText="Saving…">
              Save changes
            </Button>
          </form>
        </section>

        {/* --- Email --- */}
        <section className="rounded-2xl border border-border bg-surface">
          <SectionHeader icon={AtSign} title="Change sign-in email" />
          <form onSubmit={changeEmail} className="space-y-3.5 p-5">
            <Input
              label="New email address"
              type="email"
              autoComplete="email"
              value={emailForm.newEmail}
              error={fieldErrors.newEmail}
              onChange={(e) => setEmailForm((f) => ({ ...f, newEmail: e.target.value }))}
            />
            <PasswordInput
              label="Your password, to confirm"
              autoComplete="current-password"
              value={emailForm.currentPassword}
              error={fieldErrors.currentPassword}
              onChange={(e) => setEmailForm((f) => ({ ...f, currentPassword: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              You will sign in with the new address from now on. Other devices are signed out.
            </p>
            <Button
              type="submit"
              variant="secondary"
              isLoading={isSavingEmail}
              loadingText="Changing…"
              disabled={!emailForm.newEmail.trim() || !emailForm.currentPassword}
            >
              Change email
            </Button>
          </form>
        </section>

        {/* --- Sessions --- */}
        <section className="rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-gold" aria-hidden="true" />
              <h2 className="font-semibold">Signed-in devices</h2>
            </div>
            {otherSessions.length > 0 && (
              <Button size="sm" variant="ghost" leftIcon={LogOut} onClick={() => setRevoking(true)}>
                Sign out others
              </Button>
            )}
          </div>

          <ul className="divide-y divide-border">
            {(sessions ?? []).map((session) => (
              <li key={session.id} className="flex items-center gap-3 px-5 py-3">
                <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{session.userAgent}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.ip && `${session.ip} · `}
                    expires {formatRelativeTime(session.expiresAt)}
                  </p>
                </div>
                {session.isCurrent && (
                  <Badge variant="success" size="sm">
                    This device
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ConfirmDialog
        isOpen={isRevoking}
        onClose={() => setRevoking(false)}
        onConfirm={revokeOthers}
        title="Sign out other devices?"
        message="Every other phone, tablet and computer signed into this account will be signed out. This device stays signed in."
        confirmLabel="Sign them out"
        cancelLabel="Cancel"
      />
    </div>
  );
}

function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
      <Icon className="h-4 w-4 text-gold" aria-hidden="true" />
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}

export default AccountSecurityPanel;
