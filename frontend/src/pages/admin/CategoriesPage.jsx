import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, FolderTree, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Input, Textarea } from '@/components/ui/Input.jsx';
import { SwitchField } from '@/components/ui/Switch.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { adminCatalogApi } from '@/features/catalog/adminCatalog.api.js';
import {
  Thumbnail,
  StatusBanner,
  useFlash,
  ImageUploadButton,
  ChannelPicker,
  ChannelBadges,
} from '@/components/admin/CatalogShared.jsx';
import { staggerContainer, staggerItem } from '@/lib/motion.js';

/**
 * Categories.
 * ---------------------------------------------------------------------------
 * The families the menu is organised into — Roast Chicken, Bakery, Beverages —
 * with their artwork, channels and order.
 */

const EMPTY = {
  name: '',
  description: '',
  displayOrder: '',
  image: null,
  isActive: true,
  channels: ['web', 'pos'],
};

export function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | category
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { notice, flash } = useFlash();

  const load = useCallback(async () => {
    try {
      setCategories((await adminCatalogApi.listCategories()) ?? []);
    } catch (error) {
      flash('error', error.message ?? 'Could not load categories');
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return categories;
    return categories.filter(
      (c) => c.name.toLowerCase().includes(term) || (c.description ?? '').toLowerCase().includes(term),
    );
  }, [categories, search]);

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const result = await adminCatalogApi.deleteCategory(target.id);
      // The server distinguishes archive from delete — surface its wording
      // rather than claiming the record is gone.
      flash('success', result?.message ?? `${target.name} removed`);
      await load();
    } catch (error) {
      flash('error', error.message ?? 'Could not delete the category');
    }
  }

  if (isLoading) return <SectionLoader label="Loading categories" />;

  const totalProducts = categories.reduce((sum, c) => sum + (c.productCount ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-sm text-muted-foreground">
            {categories.length} categories holding {totalProducts} items — the menu groupings customers browse
            and cashiers filter by.
          </p>
        </div>
        <Button leftIcon={Plus} onClick={() => setEditing('new')}>
          Add Category
        </Button>
      </header>

      <StatusBanner notice={notice} />

      <SearchInput
        className="max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search categories…"
        label="Search categories"
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title={search ? 'No categories match that search' : 'No categories yet'}
          body={
            search
              ? 'Try a different word, or clear the search.'
              : 'A product must belong to a category, so start here.'
          }
          // No "Add" button when a search is responsible for the emptiness —
          // the fix there is to clear the search, not to create a category.
          action={
            search ? (
              <Button variant="outline" onClick={() => setSearch('')}>
                Clear search
              </Button>
            ) : (
              <Button leftIcon={Plus} onClick={() => setEditing('new')}>
                Add Category
              </Button>
            )
          }
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {visible.map((category) => (
            <motion.article
              key={category.id}
              variants={staggerItem}
              className="overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-gold/40"
            >
              <Thumbnail src={category.image} alt="" className="h-32 w-full" />

              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{category.name}</h2>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {category.productCount} item{category.productCount === 1 ? '' : 's'}
                      </span>
                      <ChannelBadges channels={category.channels} />
                    </p>
                  </div>
                  {!category.isActive && (
                    <Badge variant="warning" size="sm">
                      <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />
                      Hidden
                    </Badge>
                  )}
                </div>

                {category.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{category.description}</p>
                )}

                <div className="mt-4 flex justify-end gap-1 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setEditing(category)}
                    aria-label={`Edit ${category.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-raised hover:text-gold"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(category)}
                    aria-label={`Delete ${category.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
        </motion.div>
      )}

      <CategoryModal
        state={editing === 'new' ? {} : editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          flash('success', message);
          await load();
        }}
        onError={(message) => flash('error', message)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deleteTarget?.name}?`}
        message="A category that still contains products cannot be deleted — the server will tell you how many are attached so you can move them first."
        confirmLabel="Delete"
      />
    </div>
  );
}

/** Create / edit a category, including its artwork. */
function CategoryModal({ state, onClose, onSaved, onError }) {
  const isOpen = state !== null && state !== undefined;
  const isEditing = Boolean(state?.id);

  const [form, setForm] = useState(EMPTY);
  const [isSaving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      name: state.name ?? '',
      description: state.description ?? '',
      displayOrder: String(state.displayOrder ?? ''),
      image: state.image ?? null,
      isActive: state.isActive ?? true,
      channels: state.channels?.length ? state.channels : ['web', 'pos'],
    });
    setFieldErrors({});
  }, [isOpen, state]);

  async function save() {
    setSaving(true);
    setFieldErrors({});
    try {
      const payload = {
        name: form.name,
        isActive: form.isActive,
        channels: form.channels,
        ...(form.description && { description: form.description }),
        ...(form.displayOrder !== '' && { displayOrder: form.displayOrder }),
        // Always sent, including null, so artwork can be removed as well as set.
        image: form.image || null,
      };

      if (isEditing) {
        await adminCatalogApi.updateCategory(state.id, payload);
        onSaved(`"${form.name}" updated`);
      } else {
        await adminCatalogApi.createCategory(payload);
        onSaved(`"${form.name}" created`);
      }
    } catch (error) {
      if (Array.isArray(error.details)) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
      }
      onError(error.message ?? 'Could not save the category');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Category' : 'Add Category'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={isSaving} loadingText="Saving…">
            {isEditing ? 'Update' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Category Name"
          placeholder="Roast Chicken"
          value={form.name}
          error={fieldErrors.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          required
          autoFocus
        />

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Category Image</span>
          <div className="flex items-center gap-4">
            <Thumbnail src={form.image} alt="" className="h-20 w-20 rounded-xl" />
            <div className="space-y-2">
              <ImageUploadButton
                label={form.image ? 'Replace Image' : 'Upload Image'}
                folder="categories"
                onUploaded={(url) => setForm((p) => ({ ...p, image: url }))}
                onError={onError}
              />
              {form.image && (
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, image: null }))}
                  className="block text-xs text-muted-foreground underline hover:text-destructive"
                >
                  Remove image
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Shown on the storefront category cards.</p>
        </div>

        <Textarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        />
        <Input
          label="Display Order"
          type="number"
          min="0"
          placeholder="1"
          value={form.displayOrder}
          onChange={(e) => setForm((p) => ({ ...p, displayOrder: e.target.value }))}
          hint="Lower numbers appear first on the menu and the till."
        />
        <ChannelPicker value={form.channels} onChange={(channels) => setForm((p) => ({ ...p, channels }))} />
        <SwitchField
          label="Active"
          description="Shown on the menu and the tills."
          checked={form.isActive}
          onChange={(on) => setForm((p) => ({ ...p, isActive: on }))}
        />
      </div>
    </Modal>
  );
}

export default CategoriesPage;
