import { useState } from 'react';
import { Archive, CheckCheck, Inbox, Mail, MailOpen, Phone, Reply } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { StatusBanner, useFlash } from '@/components/admin/CatalogShared.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { formatDateTime, formatRelativeTime } from '@/lib/format.js';
import { cn, useDebouncedValue } from '@/lib/utils.js';

/**
 * Contact messages — /admin/messages
 * ---------------------------------------------------------------------------
 * Everything sent through the Contact Us form. Messages are stored before any
 * email is attempted, so an enquiry is never lost to a mail outage; this is
 * where they are read, marked replied and archived. (Settings → Contact page →
 * "Send messages to" chooses who is emailed a copy.)
 */

const FILTERS = [
  { key: 'new', label: 'New' },
  { key: 'read', label: 'Read' },
  { key: 'replied', label: 'Replied' },
  { key: 'archived', label: 'Archived' },
  { key: '', label: 'All' },
];

const STATUS_BADGE = { new: 'gold', read: 'default', replied: 'success', archived: 'default' };

export function MessagesPage() {
  const { can } = useAuth();
  const canManage = can('customer.manage');
  const [status, setStatus] = useState('new');
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 350);
  const { notice, flash } = useFlash();

  const { data, isLoading, error, reload } = useResource(
    () =>
      apiClient.get('/messages', {
        params: { ...(status && { status }), ...(query && { search: query }), limit: 100 },
        _wantEnvelope: true,
      }),
    [status, query],
  );
  const messages = data?.data ?? [];
  const unread = data?.meta?.unread ?? 0;

  async function setMessageStatus(message, next) {
    try {
      await apiClient.patch(`/messages/${message.id}/status`, { status: next });
      reload();
    } catch (err) {
      flash('error', err.message ?? 'Could not update the message');
    }
  }

  function open(message) {
    setOpenId((current) => (current === message.id ? null : message.id));
    // Opening a new message marks it read.
    if (canManage && message.status === 'new') setMessageStatus(message, 'read');
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          Contact Messages
          {unread > 0 && <Badge variant="solid">{unread} new</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">Sent from the Contact Us page on your website.</p>
      </header>

      <StatusBanner notice={notice} />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter messages" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              type="button"
              onClick={() => setStatus(f.key)}
              aria-pressed={status === f.key}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                status === f.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'border border-border-strong text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SearchInput
          size="sm"
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          placeholder="Name, email, phone or words…"
          label="Search messages"
        />
      </div>

      {isLoading && !data ? (
        <SectionLoader label="Loading messages" />
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          {error.message}
        </p>
      ) : messages.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={query ? 'No matching messages' : 'No messages here'}
          body={query ? 'Try a different search.' : 'Messages from the Contact Us form appear here.'}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {messages.map((message) => {
            const isOpen = openId === message.id;
            return (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => open(message)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/60"
                >
                  {message.status === 'new' ? (
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  ) : (
                    <MailOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('font-medium', message.status === 'new' && 'font-bold')}>
                        {message.name}
                      </span>
                      <Badge size="sm" variant={STATUS_BADGE[message.status]}>
                        {message.status}
                      </Badge>
                    </div>
                    <p
                      className={cn('truncate text-sm', isOpen ? 'text-foreground' : 'text-muted-foreground')}
                    >
                      {message.subject ? `${message.subject} — ` : ''}
                      {message.message}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(message.at)}>
                    {formatRelativeTime(message.at)}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-border bg-background/40 px-11 py-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.message}</p>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <a
                        href={`mailto:${message.email}`}
                        className="flex items-center gap-1.5 hover:text-gold"
                      >
                        <Mail className="h-4 w-4" aria-hidden="true" /> {message.email}
                      </a>
                      {message.phone && (
                        <a
                          href={`tel:${message.phone}`}
                          className="flex items-center gap-1.5 hover:text-gold"
                        >
                          <Phone className="h-4 w-4" aria-hidden="true" /> {message.phone}
                        </a>
                      )}
                      <span>{formatDateTime(message.at)}</span>
                      {message.emailDelivered === false && (
                        <span className="text-warning">Email copy not delivered</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        as="a"
                        size="sm"
                        leftIcon={Reply}
                        href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject || 'Your message'}`)}`}
                      >
                        Reply by email
                      </Button>
                      {canManage && message.status !== 'replied' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={CheckCheck}
                          onClick={() => setMessageStatus(message, 'replied')}
                        >
                          Mark replied
                        </Button>
                      )}
                      {canManage && message.status !== 'archived' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={Archive}
                          onClick={() => setMessageStatus(message, 'archived')}
                        >
                          Archive
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default MessagesPage;
