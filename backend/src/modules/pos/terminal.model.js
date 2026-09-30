/**
 * POS terminal — a registered till.
 * ---------------------------------------------------------------------------
 * A terminal must be registered and active before anyone can sign in on it,
 * so sales are always attributed to a real till and a lost device can be taken
 * out of service.
 */
import mongoose from 'mongoose';

const terminalSchema = new mongoose.Schema(
  {
    /**
     * Short code the device identifies itself with, e.g. TILL-01.
     * Uppercased on save so `till-01` and `TILL-01` cannot become two tills.
     */
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 24,
      match: [/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only'],
    },

    name: { type: String, required: true, trim: true, maxlength: 80 },

    /**
     * Which counter this till stands on.
     *
     * This is what makes POS scoping work: the cashier never chooses a store,
     * it is implied by the terminal they signed in at. A till physically sits
     * at one counter, so asking the person to pick would only create a way to
     * pick wrong.
     */
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },

    location: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 300 },

    /**
     * What this till sells — narrower than the store, when the owner wants it.
     *
     *   all         everything the store allows (the default)
     *   categories  only products in `menuCategories` — a bakery till, a
     *               sauces-and-sides till
     *   products    only the products listed in `menuProducts`
     *
     * It narrows the store scope; it never widens it. A bakery till scoped to
     * "Drinks" shows drinks sold at the bakery or everywhere — not the chicken
     * counter's own drinks.
     *
     * Enforced on the server, at every door the till has: the menu, the scan
     * lookup and, crucially, the pricing of a sale. A till that could not see
     * an item but could still sell it by id would make this cosmetic.
     */
    menuMode: { type: String, enum: ['all', 'categories', 'products'], default: 'all' },
    menuCategories: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    menuProducts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },

    /**
     * Disabling a till blocks new sign-ins immediately. It does not delete
     * anything — the sales and shifts recorded on it stay exactly where they
     * are, because they are financial records.
     */
    isActive: { type: Boolean, default: true, index: true },

    /** Set on each successful terminal sign-in, for a simple "in use" view. */
    lastUsedAt: Date,
    lastUsedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Terminal = mongoose.model('Terminal', terminalSchema);
export default Terminal;
