import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Package, X, FolderTree } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Input, Select, Textarea } from '@/components/ui/Input.jsx';
import { SwitchField } from '@/components/ui/Switch.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { SortableHeader } from '@/components/ui/SortableHeader.jsx';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { adminCatalogApi } from '@/features/catalog/adminCatalog.api.js';
import { apiClient } from '@/services/apiClient.js';
import {
  ChannelPicker,
  ChannelBadges,
  Thumbnail,
  StockBadge,
  StatusBanner,
  useFlash,
  ImageUploadButton,
} from '@/components/admin/CatalogShared.jsx';
import { formatCurrency } from '@/lib/format.js';
import { useDebouncedValue } from '@/lib/utils.js';
import { ROUTES } from '@/constants/routes.js';

/**
 * Products.
 * ---------------------------------------------------------------------------
 * Everything the business sells, online and at the till: a searchable,
 * filterable list with the form in a modal.
 */

const UNITS = [
  { value: 'kg', label: 'Kg' },
  { value: 'g', label: 'Gram' },
  { value: 'pcs', label: 'Pcs' },
  { value: 'pack', label: 'Pack' },
  { value: 'box', label: 'Box' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'plate', label: 'Plate' },
  { value: 'ltr', label: 'Litre' },
];

const EMPTY_PRODUCT = {
  // '' means "sold at every counter" — the default, because drinks and sides
  // exist once in stock rather than once per till.
  store: '',
  name: '',
  category: '',
  barcode: '',
  sku: '',
  unit: 'pcs',
  price: '',
  costPrice: '',
  description: '',
  image: null,
  stock: '',
  discountPercent: '',
  isActive: true,
  isFeatured: false,
  // Both by default — the safe answer before the owner has decided.
  channels: ['web', 'pos'],
};

export function ProductsPage() {
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [isLoading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState('');

  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSaving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  /*
   * Which products the table shows.
   *
   * Defaults to `active`, and that default is the fix for "I deleted it and it
   * is still there". A product that has appeared on an order is archived rather
   * than deleted — its receipts and reports still refer to it — but the list
   * had no status filter at all, so the server's default (`all`) applied and
   * the archived row stayed exactly where it was, indistinguishable from a
   * failed delete.
   *
   * Archived items are one dropdown away rather than gone, because an owner who
   * archived something by mistake still needs to find it and put it back.
   */
  const [statusFilter, setStatusFilter] = useState('active');

  const { notice, flash } = useFlash();

  /*
   * Reference data, fetched once. Categories and stores fill the form's
   * dropdowns and change far less often than the catalogue itself, so they are
   * deliberately not re-fetched every time a filter moves.
   */
  const loadReferenceData = useCallback(async () => {
    try {
      const [categoryList, storeList] = await Promise.all([
        adminCatalogApi.listCategories(),
        // Non-fatal: someone without `store.view` still manages the catalogue,
        // they simply do not get the counter selector. Letting this reject
        // would take the whole screen down for them.
        apiClient.get('/stores').catch(() => []),
      ]);
      setCategories(categoryList ?? []);
      setStores(storeList ?? []);
    } catch (error) {
      flash('error', error.message ?? 'Could not load categories');
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // Search, filter and sort run on the server, across the whole catalogue.
  const debouncedSearch = useDebouncedValue(search);

  const {
    rows: products,
    meta,
    isLoading: isListLoading,
    error: listError,
    reload,
    goToPage,
  } = usePagedResource(
    ({ page, limit }) =>
      adminCatalogApi.listProducts({
        page,
        limit,
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
        ...(categoryFilter && { category: categoryFilter }),
        status: statusFilter,
        ...(sort && { sort }),
      }),
    [debouncedSearch, categoryFilter, statusFilter, sort],
  );

  /*
   * Is the list narrowed? This decides which empty state to show: an empty
   * catalogue offers the create button, an empty filter offers to clear itself.
   * It reads the live `search`, not the debounced copy, so the message flips
   * the moment someone types rather than a beat later.
   */
  // `statusFilter` counts as a filter unless it is showing everything — an
  // owner whose only archived product is hidden by the default view needs the
  // empty state to offer "clear filters", not "create your first product".
  const hasFilters = Boolean(search.trim() || categoryFilter || statusFilter !== 'all');

  /** Put every filter back to "show everything". */
  const resetFilters = useCallback(() => {
    setSearch('');
    setCategoryFilter('');
    setStatusFilter('all');
  }, []);

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear the error as soon as the user edits the offending field — leaving
    // it visible while they type reads as "still wrong".
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  function openNew() {
    setForm(EMPTY_PRODUCT);
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(product) {
    setForm({
      // May arrive populated or as a bare id, depending on the endpoint.
      store: product.store?._id ?? product.store ?? '',
      name: product.name ?? '',
      category: product.category?._id ?? product.category ?? '',
      barcode: product.barcode ?? '',
      sku: product.sku ?? '',
      unit: product.unit ?? 'pcs',
      price: String(product.price ?? ''),
      costPrice: String(product.costPrice ?? ''),
      description: product.description ?? '',
      image: product.image ?? null,
      stock: String(product.stock ?? ''),
      discountPercent: String(product.discountPercent ?? ''),
      isActive: product.isActive ?? true,
      isFeatured: product.isFeatured ?? false,
      channels: product.channels?.length ? product.channels : ['web', 'pos'],
    });
    setFieldErrors({});
    setEditing(product);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    // Empty optional numerics are omitted rather than sent as '' — the server
    // would coerce '' to 0 and silently price the item at zero.
    const payload = {
      name: form.name,
      category: form.category,
      unit: form.unit,
      price: form.price,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      channels: form.channels,
      ...(form.description && { description: form.description }),
      ...(form.barcode && { barcode: form.barcode }),
      ...(form.sku && { sku: form.sku }),
      ...(form.costPrice !== '' && { costPrice: form.costPrice }),
      ...(form.stock !== '' && { stock: form.stock }),
      ...(form.discountPercent !== '' && { discountPercent: form.discountPercent }),
      // These two are sent always, including as null: omitting them on an edit
      // would make it impossible to remove an image, or to move an item back to
      // "every counter" once it has been assigned to one.
      image: form.image || null,
      store: form.store || null,
    };

    try {
      if (editing !== 'new') {
        await adminCatalogApi.updateProduct(editing.id, payload);
        flash('success', `"${payload.name}" updated`);
      } else {
        await adminCatalogApi.createProduct(payload);
        flash('success', `"${payload.name}" added to the menu`);
      }
      setEditing(null);
      await reload();
    } catch (error) {
      // Map field-level details onto the inputs so the user sees which field is
      // wrong, not just a banner.
      if (Array.isArray(error.details)) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
      }
      flash('error', error.message ?? 'Could not save the product');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const result = await adminCatalogApi.deleteProduct(target.id);
      flash('success', result?.message ?? `${target.name} removed`);
      await reload();
    } catch (error) {
      flash('error', error.message ?? 'Could not delete the product');
    }
  }

  /*
   * Both must be ready. Rendering the table while categories are still loading
   * shows every row's category as blank for a moment, which reads as data loss
   * rather than as loading.
   */
  if (isLoading || (isListLoading && products.length === 0)) {
    return <SectionLoader label="Loading products" />;
  }

  if (listError) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
        {listError.message ?? 'Could not load products.'}
      </div>
    );
  }

  const storeNameOf = (product) => {
    const id = product.store?._id ?? product.store;
    if (!id) return 'Every counter';
    return stores.find((s) => s.id === String(id))?.name ?? 'Assigned';
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} items — changes appear on the website and the till immediately.
          </p>
        </div>
        <Button leftIcon={Plus} onClick={openNew} disabled={categories.length === 0}>
          Add Product
        </Button>
      </header>

      <StatusBanner notice={notice} />

      {/* A product cannot exist without a category, so say so rather than
          letting the user open a form they cannot submit. */}
      {categories.length === 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Create a category first — every product must belong to one.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="min-w-[240px] flex-1 sm:max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, SKU or barcode…"
          label="Search products"
        />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className="h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none"
        >
          <option value="active">On sale</option>
          <option value="inactive">Archived &amp; hidden</option>
          <option value="low-stock">Low stock</option>
          <option value="all">All products</option>
        </select>

        {(search || categoryFilter || sort) && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCategoryFilter('');
              setSort('');
            }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </button>
        )}

        <span className="ml-auto text-sm text-muted-foreground">
          {meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : '—'}
        </span>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasFilters ? 'Nothing matches those filters' : 'No products yet'}
          body={
            !hasFilters
              ? categories.length === 0
                ? 'Products live inside categories, so create a category first.'
                : 'Add your first item to put it on the website and the till.'
              : 'Try a different search, or clear the filters.'
          }
          // An empty catalogue offers the create button; an empty filter offers
          // to clear itself. Same panel, opposite remedies.
          action={
            !hasFilters ? (
              categories.length === 0 ? (
                <Button as={Link} to={ROUTES.ADMIN_CATEGORIES} variant="outline" leftIcon={FolderTree}>
                  Go to Categories
                </Button>
              ) : (
                <Button leftIcon={Plus} onClick={openNew}>
                  Add Product
                </Button>
              )
            ) : (
              <Button variant="outline" onClick={resetFilters}>
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <section className="rounded-2xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <SortableHeader column="name" sort={sort} onSort={setSort} className="px-5">
                    Product
                  </SortableHeader>
                  <SortableHeader column="category" sort={sort} onSort={setSort}>
                    Category
                  </SortableHeader>
                  {/*
                    "Sold at", "Channel" and "Barcode" are not sortable: the
                    first two are sets rather than values, and ordering by
                    barcode sorts by the packaging supplier's numbering, which
                    means nothing to anyone reading this table.
                  */}
                  <th className="px-3 py-2.5 font-medium">Sold at</th>
                  <th className="px-3 py-2.5 font-medium">Channel</th>
                  <th className="px-3 py-2.5 font-medium">Barcode</th>
                  <SortableHeader column="price" sort={sort} onSort={setSort} align="right">
                    Price
                  </SortableHeader>
                  <SortableHeader column="stock" sort={sort} onSort={setSort} align="center">
                    Stock
                  </SortableHeader>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((product) => (
                  <tr key={product.id} className="transition-colors hover:bg-surface-hover">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumbnail src={product.image} alt="" className="h-9 w-9 rounded-lg" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.name}</p>
                          <div className="flex gap-1">
                            {!product.isActive && (
                              <Badge variant="warning" size="sm">
                                Hidden
                              </Badge>
                            )}
                            {product.isFeatured && (
                              <Badge variant="gold" size="sm">
                                Featured
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{product.category?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{storeNameOf(product)}</td>
                    <td className="px-3 py-2.5">
                      <ChannelBadges channels={product.channels} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                      {product.barcode ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatCurrency(product.price)}
                      <span className="text-xs text-muted-foreground">/{product.unitLabel}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <StockBadge product={product} />
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(product)}
                          aria-label={`Edit ${product.name}`}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-raised hover:text-gold"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(product)}
                          aria-label={`Delete ${product.name}`}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 pb-4">
            <Pagination meta={meta} onPageChange={goToPage} label="products" />
          </div>
        </section>
      )}

      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add New Product' : `Edit ${editing?.name ?? ''}`}
        size="lg"
      >
        <form onSubmit={save} className="space-y-5">
          <fieldset className="space-y-4" disabled={isSaving}>
            <Input
              label="Product Name"
              placeholder="Full Chicken Roast"
              value={form.name}
              onChange={updateField('name')}
              error={fieldErrors.name}
              required
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Category"
                placeholder="Select a category"
                value={form.category}
                onChange={updateField('category')}
                error={fieldErrors.category}
                required
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>

              <Select
                label="Sold at"
                value={form.store}
                onChange={updateField('store')}
                error={fieldErrors.store}
                hint="Which till shows this item"
              >
                {/*
                  The default, and deliberately first: most goods are not tied to
                  a counter. Drinks and sides are rung up wherever the customer
                  is standing and exist once in stock.
                */}
                <option value="">Every counter</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Barcode"
                placeholder="8901234567890"
                value={form.barcode}
                onChange={updateField('barcode')}
                error={fieldErrors.barcode}
                hint="Digits only — this is what the till scans."
                inputMode="numeric"
              />
              <Input
                label="SKU"
                placeholder="FB-RC-001"
                value={form.sku}
                onChange={updateField('sku')}
                error={fieldErrors.sku}
                hint="Your own stock code. Optional."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Unit" value={form.unit} onChange={updateField('unit')}>
                {UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </Select>

              <Input
                label="Selling Price (Rs.)"
                type="number"
                min="0"
                placeholder="1200"
                value={form.price}
                onChange={updateField('price')}
                error={fieldErrors.price}
                // Spelling out the per-unit meaning prevents the single most
                // costly data-entry mistake: entering a whole-bird price
                // against a per-kg unit.
                hint={`Price per ${UNITS.find((u) => u.value === form.unit)?.label ?? 'unit'}`}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Cost Price (Rs.)"
                type="number"
                min="0"
                placeholder="800"
                value={form.costPrice}
                onChange={updateField('costPrice')}
                hint="Never shown to customers."
              />
              <Input
                label="Stock"
                type="number"
                min="0"
                placeholder="25"
                value={form.stock}
                onChange={updateField('stock')}
              />
              <Input
                label="Discount (%)"
                type="number"
                min="0"
                max="90"
                placeholder="0"
                value={form.discountPercent}
                onChange={updateField('discountPercent')}
              />
            </div>

            <Textarea
              label="Description"
              rows={3}
              placeholder="Delicious full chicken roast with special spices."
              value={form.description}
              onChange={updateField('description')}
            />

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Product Image</span>
              <div className="flex items-center gap-4">
                <Thumbnail src={form.image} alt="" className="h-20 w-20 rounded-xl" />
                <div className="space-y-2">
                  <ImageUploadButton
                    label={form.image ? 'Replace Image' : 'Upload Image'}
                    /*
                      Filed under the category chosen on this form, so the media
                      library mirrors the menu. Falls back to 'products' while no
                      category is picked yet — the upload happens as soon as the
                      file is chosen, which can be before the dropdown is touched.
                    */
                    folder={categories.find((c) => c.id === form.category)?.name ?? 'products'}
                    onUploaded={(url) => setForm((p) => ({ ...p, image: url }))}
                    onError={(message) => flash('error', message)}
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
              <p className="text-xs text-muted-foreground">JPG, PNG, WebP or AVIF — up to 5MB.</p>
            </div>

            <ChannelPicker
              value={form.channels}
              onChange={(channels) => setForm((f) => ({ ...f, channels }))}
              error={fieldErrors.channels}
            />

            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              {/* "Active" is the master switch; the channels above decide where an active item shows. */}
              <SwitchField
                label="Active"
                description="Available for sale where it is listed."
                checked={form.isActive}
                onChange={(on) => setForm((prev) => ({ ...prev, isActive: on }))}
              />
              <SwitchField
                label="Featured"
                description="Listed first on the menu."
                checked={form.isFeatured}
                onChange={(on) => setForm((prev) => ({ ...prev, isFeatured: on }))}
              />
            </div>
          </fieldset>

          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <Button variant="outline" type="button" onClick={() => setEditing(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving} loadingText="Saving…">
              {editing === 'new' ? 'Save Product' : 'Update Product'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deleteTarget?.name}?`}
        message="If this product has ever been sold it is archived instead of deleted, so past orders and receipts stay intact."
        confirmLabel="Delete"
      />
    </div>
  );
}

export default ProductsPage;
