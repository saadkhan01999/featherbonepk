import { useEffect, useState } from 'react';
import { ExternalLink, Eye, FileText, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Input, Textarea } from '@/components/ui/Input.jsx';
import { SwitchField } from '@/components/ui/Switch.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { RichText } from '@/components/common/RichText.jsx';
import { StatusBanner, useFlash, ImageUploadButton, Thumbnail } from '@/components/admin/CatalogShared.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { pagePath } from '@/constants/routes.js';
import { formatRelativeTime } from '@/lib/format.js';
import { mediaUrl } from '@/lib/media.js';
import { cn } from '@/lib/utils.js';

/**
 * Website → Pages — /admin/pages
 * ---------------------------------------------------------------------------
 * Extra pages for the storefront, written by the owner: Privacy policy,
 * Catering, Franchise enquiries, FAQ, Careers… Each lives at /p/<address>,
 * can be linked from the header and/or footer, and stays a draft (invisible to
 * the public API, not just unlinked) until published.
 *
 * About Us and Contact Us have their own dedicated editors in Website
 * Management, because they carry structured content (figures, map, form).
 *
 * The text uses a small safe format (see RichText) — headings, bold, lists,
 * links — rendered without any raw HTML, so nothing pasted into a page can run
 * a script on the site. A live preview sits beside the editor.
 */

const EMPTY = {
  title: '',
  slug: '',
  subtitle: '',
  heroImage: '',
  body: '',
  seoDescription: '',
  showInHeader: false,
  showInFooter: true,
  isPublished: false,
  displayOrder: 0,
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export function PagesPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');
  const { notice, flash } = useFlash();
  const { data, isLoading, error, reload } = useResource(() => apiClient.get('/pages/admin/all'), []);
  const pages = data ?? [];

  const [editing, setEditing] = useState(null); // page | EMPTY
  const [deleting, setDeleting] = useState(null);

  async function remove() {
    try {
      await apiClient.delete(`/pages/${deleting.id}`);
      flash('success', `Deleted “${deleting.title}”`);
      setDeleting(null);
      reload();
    } catch (err) {
      flash('error', err.message ?? 'Could not delete the page');
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pages</h1>
          <p className="text-sm text-muted-foreground">
            Extra pages for your website — privacy policy, catering, FAQ. Published pages can appear in the
            header and footer.
          </p>
        </div>
        {canManage && (
          <Button leftIcon={Plus} onClick={() => setEditing(EMPTY)}>
            New page
          </Button>
        )}
      </header>

      <StatusBanner notice={notice} />

      {isLoading ? (
        <SectionLoader label="Loading pages" />
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          {error.message}
        </p>
      ) : pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No pages yet"
          body="Create a page for your privacy policy, catering menu or anything else customers ask about."
          action={
            canManage && (
              <Button leftIcon={Plus} onClick={() => setEditing(EMPTY)}>
                Create the first page
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Page</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Address</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Shown in</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pages.map((page) => (
                <tr key={page.id} className="hover:bg-surface-hover/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Thumbnail src={mediaUrl(page.heroImage)} className="h-10 w-14 shrink-0 rounded-md" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{page.title}</p>
                        {page.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">{page.subtitle}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground md:table-cell">
                    {pagePath(page.slug)}
                  </td>
                  <td className="px-4 py-3">
                    {page.isPublished ? (
                      <Badge variant="success" size="sm">
                        Published
                      </Badge>
                    ) : (
                      <Badge size="sm">Draft</Badge>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
                    {[page.showInHeader && 'Header', page.showInFooter && 'Footer']
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
                    {formatRelativeTime(page.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {page.isPublished && (
                        <Button
                          as="a"
                          href={pagePath(page.slug)}
                          target="_blank"
                          rel="noopener"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Open ${page.title} on the website`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={canManage ? `Edit ${page.title}` : `View ${page.title}`}
                        onClick={() => setEditing(page)}
                      >
                        {canManage ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      {canManage && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${page.title}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleting(page)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PageEditor
        page={editing}
        readOnly={!canManage}
        onClose={() => setEditing(null)}
        onSaved={(saved, isNew) => {
          flash('success', isNew ? `Created “${saved.title}”` : `Saved “${saved.title}”`);
          setEditing(null);
          reload();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Delete “${deleting?.title ?? ''}”?`}
        message={`The page at ${deleting ? pagePath(deleting.slug) : ''} stops working immediately, and its header/footer links disappear.`}
        confirmLabel="Delete page"
      />
    </div>
  );
}

function PageEditor({ page, readOnly, onClose, onSaved }) {
  const isNew = page && !page.id;
  const [form, setForm] = useState(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [tab, setTab] = useState('write');

  useEffect(() => {
    if (!page) return;
    setForm({
      ...EMPTY,
      ...page,
      subtitle: page.subtitle ?? '',
      heroImage: page.heroImage ?? '',
      body: page.body ?? '',
      seoDescription: page.seoDescription ?? '',
    });
    setSlugTouched(Boolean(page.id));
    setErrors({});
    setMessage(null);
    setTab('write');
  }, [page]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save(event) {
    event.preventDefault();
    if (readOnly) return;
    setSaving(true);
    setErrors({});
    setMessage(null);

    const payload = {
      title: form.title,
      slug: form.slug,
      subtitle: form.subtitle,
      body: form.body,
      seoDescription: form.seoDescription,
      showInHeader: form.showInHeader,
      showInFooter: form.showInFooter,
      isPublished: form.isPublished,
      displayOrder: Number(form.displayOrder) || 0,
      ...(form.heroImage ? { heroImage: form.heroImage } : isNew ? {} : { heroImage: '' }),
    };

    try {
      const saved = isNew
        ? await apiClient.post('/pages', payload)
        : await apiClient.patch(`/pages/${page.id}`, payload);
      onSaved(saved, isNew);
    } catch (err) {
      if (err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      setMessage(err.message ?? 'Could not save the page');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(page)}
      onClose={onClose}
      title={isNew ? 'New page' : readOnly ? form.title : `Edit “${page?.title ?? ''}”`}
      size="xl"
    >
      <form onSubmit={save} className="space-y-4">
        {message && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {message}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Title"
            required
            value={form.title}
            error={errors.title}
            disabled={readOnly}
            onChange={(e) => {
              set('title', e.target.value);
              if (!slugTouched) set('slug', slugify(e.target.value));
            }}
          />
          <Input
            label="Address"
            required
            value={form.slug}
            error={errors.slug}
            disabled={readOnly}
            hint={`Opens at ${pagePath(form.slug || 'your-page')}`}
            onChange={(e) => {
              setSlugTouched(true);
              set('slug', slugify(e.target.value));
            }}
          />
        </div>

        <Input
          label="Subtitle"
          value={form.subtitle}
          error={errors.subtitle}
          disabled={readOnly}
          hint="One line under the title."
          onChange={(e) => set('subtitle', e.target.value)}
        />

        {/* Banner image */}
        <div className="flex flex-wrap items-center gap-3">
          <Thumbnail src={mediaUrl(form.heroImage)} className="h-16 w-28 rounded-lg" />
          {!readOnly && (
            <>
              <ImageUploadButton
                endpoint="media"
                folder="pages"
                label={form.heroImage ? 'Replace banner' : 'Upload banner'}
                onUploaded={(url) => set('heroImage', url)}
                onError={setMessage}
              />
              {form.heroImage && (
                <Button type="button" size="sm" variant="ghost" onClick={() => set('heroImage', '')}>
                  Remove
                </Button>
              )}
            </>
          )}
          {errors.heroImage && <p className="text-sm text-destructive">{errors.heroImage}</p>}
        </div>

        {/* Body: write / preview */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium">Page text</span>
            <div role="tablist" className="flex rounded-lg border border-border-strong p-0.5 text-xs">
              {['write', 'preview'].map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'rounded-md px-2.5 py-1 font-semibold capitalize',
                    tab === key ? 'bg-gold-gradient text-gold-foreground' : 'text-muted-foreground',
                  )}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          {tab === 'write' ? (
            <>
              <Textarea
                rows={14}
                value={form.body}
                disabled={readOnly}
                error={errors.body}
                onChange={(e) => set('body', e.target.value)}
                placeholder={
                  '## Our catering menu\n\nWe cater events of **20 to 500** guests.\n\n- Karahi platters\n- BBQ\n\n[See the full menu](/menu)'
                }
                className="font-mono text-sm"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                <code># Heading</code> · <code>**bold**</code> · <code>*italic*</code> · <code>- list</code> ·{' '}
                <code>1. numbered</code> · <code>[link](https://…)</code> · <code>&gt; quote</code> ·{' '}
                <code>---</code> divider. {form.body.length.toLocaleString()} / 20,000 characters.
              </p>
            </>
          ) : (
            <div className="max-h-[50vh] min-h-[12rem] overflow-y-auto rounded-xl border border-border bg-background p-5">
              {form.body.trim() ? (
                <RichText source={form.body} />
              ) : (
                <p className="text-muted-foreground">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>

        <Input
          label="Search engine description"
          value={form.seoDescription}
          error={errors.seoDescription}
          disabled={readOnly}
          hint="Shown under the page title in Google results. Up to 200 characters."
          onChange={(e) => set('seoDescription', e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <SwitchField
            label="Published"
            description="Visible on the website."
            checked={form.isPublished}
            disabled={readOnly}
            onChange={(on) => set('isPublished', on)}
          />
          <SwitchField
            label="In the header"
            description="Linked in the top menu."
            checked={form.showInHeader}
            disabled={readOnly}
            onChange={(on) => set('showInHeader', on)}
          />
          <SwitchField
            label="In the footer"
            description="Linked at the bottom."
            checked={form.showInFooter}
            disabled={readOnly}
            onChange={(on) => set('showInFooter', on)}
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Order
            <input
              type="number"
              min={0}
              max={999}
              value={form.displayOrder}
              disabled={readOnly}
              onChange={(e) => set('displayOrder', e.target.value)}
              className="h-9 w-20 rounded-lg border border-border-strong bg-surface px-2 text-sm focus:border-gold focus:outline-none"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" isLoading={isSaving} loadingText="Saving…">
              {isNew ? 'Create page' : 'Save page'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export default PagesPage;
