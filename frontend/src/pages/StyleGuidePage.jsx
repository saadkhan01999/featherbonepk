import { useState } from 'react';
import { ShoppingCart, Plus, Trash2, Printer, Star } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card.jsx';
import { Input, PasswordInput, Select, Checkbox, SearchInput } from '@/components/ui/Input.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Spinner } from '@/components/ui/Spinner.jsx';
import { formatCurrency, formatDateTime, formatQuantity } from '@/lib/format.js';
import { config } from '@/config/env.js';

/**
 * StyleGuidePage — a living reference for the design system.
 * ---------------------------------------------------------------------------
 * Not throwaway scaffolding: this page is how the team (and future me) checks
 * that a token change still looks right everywhere, and it is where a new
 * primitive gets exercised before it is used in a real screen. It renders every
 * variant of every primitive on the real dark canvas.
 */
export function StyleGuidePage() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Brand header — the gold-on-black lockup used across the suite. */}
      <header className="border-b border-border bg-surface/60 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-gradient text-lg font-bold text-gold-foreground">
              F
            </span>
            <div className="leading-tight">
              <p className="font-bold tracking-tight">{config.brand.name}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Roast · Meat · Sweets · Bakery
              </p>
            </div>
          </div>
          <Badge variant="gold" dot>
            Design system
          </Badge>
        </div>
      </header>

      <main className="container space-y-12 py-10">
        <section>
          <h1 className="text-display-sm">Feather &amp; Bone</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Dark, warm and gold-accented. This page renders every primitive on the real canvas so token
            changes can be reviewed in one place.
          </p>
          <div className="mt-4 h-px w-40 fb-gold-rule" />
        </section>

        {/* --- Colour ------------------------------------------------------ */}
        <Section title="Colour tokens" hint="Semantic names, never raw hex, in component code.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['background', 'bg-background border border-border-strong'],
              ['surface', 'bg-surface'],
              ['surface-raised', 'bg-surface-raised'],
              ['gold', 'bg-gold'],
              ['success', 'bg-success'],
              ['destructive', 'bg-destructive'],
            ].map(([name, className]) => (
              <div key={name} className="space-y-2">
                <div className={`h-16 rounded-xl ${className}`} />
                <p className="text-xs text-muted-foreground">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* --- Buttons ----------------------------------------------------- */}
        <Section title="Buttons" hint="Visual weight matches the consequence of the action.">
          <div className="flex flex-wrap items-center gap-3">
            <Button leftIcon={ShoppingCart}>Add to Cart</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive" leftIcon={Trash2}>
              Clear Cart
            </Button>
            <Button variant="success">Paid</Button>
            <Button variant="link">Forgot password?</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="pos" leftIcon={Printer}>
              Generate Slip
            </Button>
            <Button isLoading loadingText="Processing…">
              Pay Now
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        {/* --- Badges ------------------------------------------------------ */}
        <Section title="Badges" hint="Status always carries text — never colour alone.">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="gold" icon={Star}>
              Best Seller
            </Badge>
            <Badge variant="success" dot>
              In Stock
            </Badge>
            <Badge variant="warning" dot>
              Low Stock
            </Badge>
            <Badge variant="destructive" dot>
              Out of Stock
            </Badge>
            <Badge variant="info">Processing</Badge>
            <Badge variant="solid">25% OFF</Badge>
          </div>
        </Section>

        {/* --- Cards ------------------------------------------------------- */}
        <Section title="Cards" hint="Composed from parts; hover affordances only when clickable.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card interactive>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>Full Chicken Roast</CardTitle>
                  <Badge variant="solid" size="sm">
                    Best Seller
                  </Badge>
                </div>
                <CardDescription>Slow-roasted with our signature spice blend.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-end justify-between">
                <div>
                  <p className="text-xl font-bold tabular-nums text-gold">{formatCurrency(1200)}</p>
                  <p className="text-xs text-muted-foreground">{formatQuantity(1.5, 'kg')}</p>
                </div>
                <Button size="sm" leftIcon={Plus}>
                  Add
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Subtotal" value={formatCurrency(3190)} />
                <Row label="Delivery" value={formatCurrency(60)} />
                <Row label="Tax (5%)" value={formatCurrency(162)} />
                <div className="border-t border-border pt-2">
                  <Row label="Total" value={formatCurrency(3412)} strong />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Formatting</CardTitle>
                <CardDescription>One implementation, used everywhere.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm text-muted-foreground">
                <p>{formatCurrency(1250000, { compact: true })} — compact</p>
                <p>
                  {formatQuantity(2.5, 'kg')} / {formatQuantity(3, 'pcs')}
                </p>
                <p className="text-xs">{formatDateTime(new Date())}</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* --- Forms ------------------------------------------------------- */}
        <Section title="Form controls" hint="Labels, hints and errors are wired for screen readers.">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <Input label="Full Name" placeholder="Enter your full name" required />
            <Input
              label="Email Address"
              type="email"
              placeholder="you@example.com"
              hint="We never share this."
            />
            <PasswordInput hint="At least 8 characters." />
            <Input label="Phone" placeholder="03XX XXXXXXX" error="Enter a valid Pakistani number" />
            <Select label="Category" placeholder="Select a category" defaultValue="">
              <option value="roast">Roast Chicken</option>
              <option value="mutton">Mutton &amp; Beef</option>
              <option value="bakery">Bakery</option>
            </Select>
            <SearchInput label="Search" placeholder="Search for items…" />
          </div>
          <div className="mt-4">
            <Checkbox label="Remember me on this device" defaultChecked />
          </div>
        </Section>

        {/* --- Overlays ---------------------------------------------------- */}
        <Section title="Modals" hint="Centred, animated, focus-trapped and Escape-dismissable.">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              Delete Product
            </Button>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" /> Loading state
            </span>
          </div>
        </Section>
      </main>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title="Add New Product"
        description="Create a menu item. It appears on the website and at the till immediately."
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Save Product</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Product Name" placeholder="Full Chicken Roast" required />
          <Select label="Category" placeholder="Select a category" defaultValue="">
            <option value="roast">Roast Chicken</option>
            <option value="bakery">Bakery</option>
          </Select>
          <Input label="Barcode" placeholder="8901234567890" />
          <Input label="Selling Price (Rs.)" type="number" placeholder="1200" required />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Delete this product?"
        message="It will be removed from the website and the till. Past orders keep their record of it."
        confirmLabel="Delete"
      />
    </div>
  );
}

/** Section wrapper — keeps vertical rhythm consistent down the page. */
function Section({ title, hint, children }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Label/value row used in the summary card. */
function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-base font-bold text-gold' : ''}`}>{value}</span>
    </div>
  );
}

export default StyleGuidePage;
