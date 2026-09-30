import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { ImageOff, AlertCircle, CheckCircle2, Upload, Loader2, Globe, Monitor } from 'lucide-react';

import { Badge } from '@/components/ui/Badge.jsx';
import { adminCatalogApi } from '@/features/catalog/adminCatalog.api.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';

/**
 * Pieces shared by the Categories and Products screens.
 */

/** Image with a graceful fallback — a broken <img> icon looks like a bug. */
export function Thumbnail({ src, alt = '', className }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn('flex items-center justify-center bg-surface-hover text-muted-foreground', className)}
        aria-hidden="true"
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }

  return (
    <img
      // Resolved here, once, so callers pass the raw path the API gave them.
      src={mediaUrl(src)}
      alt={alt}
      onError={() => setFailed(true)}
      className={cn('object-cover', className)}
      loading="lazy"
    />
  );
}

/** Stock level as a coloured pill. */
export function StockBadge({ product }) {
  const VARIANT = {
    in_stock: 'success',
    medium: 'warning',
    low: 'warning',
    out_of_stock: 'destructive',
  };
  const LABEL = { in_stock: 'In Stock', medium: 'Medium', low: 'Low', out_of_stock: 'Out' };

  return (
    <Badge variant={VARIANT[product.stockStatus] ?? 'default'} size="sm">
      {product.stock} · {LABEL[product.stockStatus]}
    </Badge>
  );
}

/** Transient success/error banner. */
export function StatusBanner({ notice }) {
  if (!notice) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      // Errors interrupt a screen reader; successes do not.
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
  );
}

/**
 * One banner slot, so a success and a failure can never stack and contradict
 * each other on screen.
 */
export function useFlash(timeoutMs = 6000) {
  const [notice, setNotice] = useState(null);

  const flash = useCallback(
    (type, message) => {
      setNotice({ type, message });
      window.clearTimeout(flash.timer);
      flash.timer = window.setTimeout(() => setNotice(null), timeoutMs);
    },
    [timeoutMs],
  );

  return { notice, flash };
}

/**
 * Upload button that returns a stored URL.
 *
 * Uploading is a separate step from saving the record on purpose: a validation
 * failure on the form then does not discard the image the user already chose.
 */
export function ImageUploadButton({
  onUploaded,
  onError,
  label = 'Upload Image',
  className,
  /**
   * `accept="media"` also takes video, for the storefront story clip.
   * Defaults to images because that is what every other caller wants, and a
   * product thumbnail must never be a 50MB film.
   */
  accept = 'image',
  /**
   * Where the media library should file this asset — the category name for a
   * product photo, or a fixed label for the screens that are not per-category.
   * Optional; without it the asset is grouped by month.
   */
  folder,
  /**
   * 'media' sends an image through the website-media endpoint, which needs
   * `settings.manage` rather than `product.manage` — for the logo, the About
   * photo and page banners, edited by people who may not manage products.
   */
  endpoint = 'catalog',
}) {
  const [isUploading, setUploading] = useState(false);
  const isMedia = accept === 'media';
  const viaMedia = isMedia || endpoint === 'media';

  async function handleChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = viaMedia
        ? await adminCatalogApi.uploadMedia(file, folder)
        : await adminCatalogApi.uploadImage(file, folder);
      // `kind` lets the caller switch between <img> and <video> without
      // sniffing the file extension.
      onUploaded(result.url, result.kind ?? 'image');
    } catch (error) {
      onError?.(error.message ?? (isMedia ? 'Upload failed' : 'Image upload failed'));
    } finally {
      setUploading(false);
      // Reset so re-choosing the same file fires change again.
      event.target.value = '';
    }
  }

  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-surface-hover',
        isUploading && 'pointer-events-none opacity-60',
        className,
      )}
    >
      {isUploading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Upload className="h-4 w-4" aria-hidden="true" />
      )}
      {isUploading ? 'Uploading…' : label}
      <input
        type="file"
        accept={
          isMedia
            ? 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime'
            : 'image/jpeg,image/png,image/webp,image/avif'
        }
        onChange={handleChange}
        className="sr-only"
      />
    </label>
  );
}

/**
 * Where an item is sold — website, till, or both.
 * ---------------------------------------------------------------------------
 * Used by the Products form and the Categories form, which is why it lives
 * here rather than being written twice and drifting apart.
 *
 * Why this is not two catalogues. The shop needs different things on the two
 * surfaces — a tray of fresh naan is rung up at the counter but makes no sense
 * to ship; a party platter may be order-ahead only. The tempting fix is a
 * separate POS catalogue, and it is the wrong one: two catalogues means two
 * stock counts, and two stock counts disagree the first busy afternoon. This
 * hides the item on one surface while both keep drawing down the same stock.
 *
 * At least one must stay ticked. Unticking both would remove the item from
 * sale entirely, which is a deletion pretending to be a visibility setting —
 * so the last one is disabled rather than silently allowed.
 */
export function ChannelPicker({ value = [], onChange, label = 'Where is this sold?', error }) {
  const channels = [
    { key: 'web', icon: Globe, title: 'Website', hint: 'Customers can order it online' },
    { key: 'pos', icon: Monitor, title: 'Till (POS)', hint: 'Cashiers can ring it up at the counter' },
  ];

  const selected = value.length ? value : ['web', 'pos'];

  function toggle(key) {
    const next = selected.includes(key) ? selected.filter((c) => c !== key) : [...selected, key];
    if (next.length === 0) return; // Guarded below too; belt and braces.
    onChange(next);
  }

  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>

      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {channels.map(({ key, icon: Icon, title, hint }) => {
          const on = selected.includes(key);
          const isLast = on && selected.length === 1;

          return (
            <label
              key={key}
              title={isLast ? 'Keep at least one — otherwise it is not for sale anywhere' : undefined}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors',
                on ? 'border-gold/50 bg-gold/5' : 'border-border hover:border-border-strong',
                isLast && 'cursor-not-allowed opacity-80',
              )}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={isLast}
                onChange={() => toggle(key)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--gold))]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                  {title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

/** Compact read-only version for list rows. */
export function ChannelBadges({ channels = [] }) {
  const list = channels.length ? channels : ['web', 'pos'];
  // Both is the common case and the default — saying so twice on every row is
  // noise, so it collapses to one quiet label.
  if (list.length === 2) {
    return <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Web + Till</span>;
  }
  return (
    <Badge variant={list[0] === 'pos' ? 'gold' : 'info'} size="sm">
      {list[0] === 'pos' ? 'Till only' : 'Website only'}
    </Badge>
  );
}
