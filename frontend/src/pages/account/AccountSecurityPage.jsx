import { AccountSecurityPanel } from '@/components/account/AccountSecurityPanel.jsx';

/**
 * Profile details and security, for a customer's account area.
 * The forms live in AccountSecurityPanel, shared with the back office's
 * My Profile page so both use one implementation of the password policy.
 */
export function AccountSecurityPage() {
  return <AccountSecurityPanel />;
}

export default AccountSecurityPage;
