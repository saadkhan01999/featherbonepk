import { useState } from 'react';
import {
  BadgeCheck,
  EyeOff,
  Globe,
  Lock,
  Mail,
  MessageSquareReply,
  Phone,
  Star,
  Trash2,
  Inbox,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Textarea } from '@/components/ui/Input.jsx';
import { ConfirmDialog } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { StarRating } from '@/components/common/StarRating.jsx';
import { TAG_LABEL, isFixTag } from '@/features/feedback/feedbackTags.js';
import { StatusBanner, useFlash } from '@/components/admin/CatalogShared.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useResource } from '@/features/catalog/catalog.api.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { feedbackApi } from '@/features/feedback/feedback.api.js';
import { EVENTS, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { formatDateTime, formatRelativeTime } from '@/lib/format.js';
import { cn, useDebouncedValue } from '@/lib/utils.js';

/**
 * Website feedback — what visitors sent from the Feedback page.
 * ---------------------------------------------------------------------------
 * Read it, reply (the reply is shown under it on the website), and publish the
 * ones to show. Feedback whose author did not allow publishing can be read and
 * answered but never published. New submissions appear here live.
 */

const TABS = [
  { key: 'new', label: 'New' },
  { key: 'published', label: 'On the website' },
  { key: 'hidden', label: 'Hidden' },
  { key: '', label: 'All' },
];

const ASPECT_LABEL = { food: 'Food', service: 'Service', delivery: 'Delivery', value: 'Value' };

export function WebsiteFeedbackPanel() {
  const { can } = useAuth();
  const canModerate = can('review.moderate');
  const [status, setStatus] = useState('new');
  const [rating, setRating] = useState('');
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 350);
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { notice, flash } = useFlash();

  const { rows, meta, isLoading, error, reload, goToPage } = usePagedResource(
    ({ page, limit }) =>
      feedbackApi.list({
        page,
        limit,
        ...(status && { status }),
        ...(rating && { rating }),
        ...(query && { search: query }),
      }),
    [status, rating, query],
  );
  const { data: stats, reload: reloadStats } = useResource(() => feedbackApi.stats(), []);

  // A new submission rings the bell; the same signal refreshes this list.
  const refresh = useDebouncedCallback(() => {
    reload();
    reloadStats();
  }, 500);
  useRealtimeEvent('web', EVENTS.NOTIFICATIONS_CHANGED, refresh);

  async function act(item, payload, message) {
    setBusy(item.id);
    try {
      await feedbackApi.moderate(item.id, payload);
      flash('success', message);
      reload();
      reloadStats();
    } catch (err) {
      flash('error', err.message ?? 'Could not update this feedback');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      await feedbackApi.remove(deleting.id);
      flash('success', 'Feedback deleted');
      setDeleting(null);
      reload();
      reloadStats();
    } catch (err) {
      flash('error', err.message ?? 'Could not delete');
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Average rating',
            value: stats?.average != null ? stats.average.toFixed(1) : '—',
            icon: Star,
            tone: 'text-gold',
          },
          { label: 'New', value: stats?.byStatus?.new ?? 0, icon: Inbox, tone: 'text-warning' },
          {
            label: 'On the website',
            value: stats?.byStatus?.published ?? 0,
            icon: Globe,
            tone: 'text-success',
          },
          {
            label: 'All feedback',
            value: stats?.total ?? 0,
            icon: MessageSquareReply,
            tone: 'text-muted-foreground',
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
              <card.icon className={cn('h-4 w-4', card.tone)} aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {stats?.topTags?.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Most mentioned</p>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {stats.topTags.map((row) => (
              <li key={row.tag}>
                <TagPill tag={row.tag} count={row.count} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <StatusBanner notice={notice} />

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap rounded-lg border border-border-strong p-0.5"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key || 'all'}
              type="button"
              onClick={() => setStatus(tab.key)}
              aria-pressed={status === tab.key}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === tab.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.key && stats?.byStatus?.[tab.key] > 0 && (
                <span className="ml-1.5 tabular-nums opacity-75">({stats.byStatus[tab.key]})</span>
              )}
            </button>
          ))}
        </div>
        <select
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          aria-label="Filter by stars"
          className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">Any rating</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} star{n === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <SearchInput
          size="sm"
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          placeholder="Name, order number or words…"
          label="Search feedback"
        />
      </div>

      {isLoading ? (
        <SectionLoader label="Loading feedback" />
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          {error.message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={status === 'new' ? 'Nothing new' : 'No feedback here'}
          body="Feedback from the website's Feedback page appears here the moment it is sent."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((item) => (
            <FeedbackItem
              key={item.id}
              item={item}
              canModerate={canModerate}
              isBusy={busy === item.id}
              onPublish={() => act(item, { status: 'published' }, 'Published — it is on the website now')}
              onHide={() => act(item, { status: 'hidden' }, 'Hidden from the website')}
              onReply={(reply) => act(item, { reply }, reply ? 'Reply saved' : 'Reply removed')}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </ul>
      )}

      <Pagination meta={meta} onPageChange={goToPage} label="feedback" />

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this feedback?"
        message="It is removed for good, from here and from the website. Hiding keeps it for your records instead."
        confirmLabel="Delete"
      />
    </div>
  );
}

function FeedbackItem({ item, canModerate, isBusy, onPublish, onHide, onReply, onDelete }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(item.reply ?? '');
  const aspects = Object.entries(item.aspects ?? {}).filter(([, v]) => v);

  return (
    <li className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StarRating value={item.rating} size="sm" />
            <span className="font-semibold">{item.fullName}</span>
            {item.verifiedOrder && (
              <Badge variant="success" size="sm" icon={BadgeCheck}>
                Order {item.orderNumber}
              </Badge>
            )}
            {!item.verifiedOrder && item.orderNumber && (
              <Badge size="sm">Order {item.orderNumber} (not found)</Badge>
            )}
            <Badge
              size="sm"
              variant={item.status === 'published' ? 'success' : item.status === 'new' ? 'gold' : 'default'}
            >
              {item.status === 'published' ? 'On the website' : item.status}
            </Badge>
            {!item.allowPublish && (
              <Badge size="sm" icon={Lock}>
                Private
              </Badge>
            )}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span title={formatDateTime(item.createdAt)}>{formatRelativeTime(item.createdAt)}</span>
            {item.email && (
              <a href={`mailto:${item.email}`} className="flex items-center gap-1 hover:text-gold">
                <Mail className="h-3 w-3" aria-hidden="true" /> {item.email}
              </a>
            )}
            {item.phone && (
              <a href={`tel:${item.phone}`} className="flex items-center gap-1 hover:text-gold">
                <Phone className="h-3 w-3" aria-hidden="true" /> {item.phone}
              </a>
            )}
          </p>
        </div>
      </div>

      {item.tags?.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tapped">
          {item.tags.map((tag) => (
            <li key={tag}>
              <TagPill tag={tag} />
            </li>
          ))}
        </ul>
      )}
      {item.comment ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{item.comment}</p>
      ) : (
        !item.tags?.length && (
          <p className="mt-3 text-sm italic text-muted-foreground">Stars only — no comment.</p>
        )
      )}

      {aspects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {aspects.map(([key, value]) => (
            <span
              key={key}
              className="flex items-center gap-1.5 rounded-lg bg-surface-raised px-2 py-1 text-xs"
            >
              {ASPECT_LABEL[key] ?? key}
              <StarRating value={value} size="sm" />
            </span>
          ))}
        </div>
      )}

      {item.reply && !replying && (
        <p className="mt-3 rounded-xl border-l-2 border-gold/60 bg-gold/5 px-3 py-2 text-sm">
          <span className="font-semibold text-gold">Your reply: </span>
          {item.reply}
        </p>
      )}

      {replying && (
        <div className="mt-3 space-y-2">
          <Textarea
            label="Reply (shown under the feedback on the website)"
            rows={3}
            maxLength={600}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              isLoading={isBusy}
              onClick={() => {
                onReply(reply.trim());
                setReplying(false);
              }}
            >
              Save reply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canModerate && !replying && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          {item.status !== 'published' && item.allowPublish && (
            <Button size="sm" variant="success" leftIcon={Globe} isLoading={isBusy} onClick={onPublish}>
              Publish on website
            </Button>
          )}
          {item.status !== 'hidden' && (
            <Button size="sm" variant="secondary" leftIcon={EyeOff} disabled={isBusy} onClick={onHide}>
              {item.status === 'published' ? 'Take off website' : 'Hide'}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            leftIcon={MessageSquareReply}
            onClick={() => setReplying(true)}
          >
            {item.reply ? 'Edit reply' : 'Reply'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={Trash2}
            onClick={onDelete}
            className="ml-auto text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

/** A tag the customer tapped — gold for praise, amber for something to fix. */
function TagPill({ tag, count }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        isFixTag(tag)
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-gold/40 bg-gold/10 text-gold',
      )}
    >
      {TAG_LABEL[tag] ?? tag}
      {count !== undefined && <span className="tabular-nums opacity-75">{count}</span>}
    </span>
  );
}

export default WebsiteFeedbackPanel;
