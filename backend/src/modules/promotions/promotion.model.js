/**
 * Promotion — a scheduled offer shown on the storefront.
 * ---------------------------------------------------------------------------
 * These were page constants in OffersPage.jsx, which meant every seasonal
 * campaign needed a developer and a deploy. An Eid offer that goes live because
 * someone remembered to push on the right morning is not a campaign, it is a
 * hazard.
 */
import mongoose from 'mongoose';

/** Campaign categories — the filter pills on the offers page. */
export const PROMOTION_TYPES = Object.freeze(['combo', 'eid', 'weekend', 'seasonal']);

/**
 * Where a banner appears.
 *
 * A hero slide and an offer card are the same thing in different slots: an
 * image, a headline and a call to action, shown between two dates. Modelling
 * them separately would duplicate the scheduling logic — and the second copy is
 * the one that stops getting maintained.
 */
export const PLACEMENTS = Object.freeze(['offers', 'hero']);

const promotionSchema = new mongoose.Schema(
  {
    /** Small label above the title, e.g. "Eid Special". */
    kicker: { type: String, required: true, trim: true, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    /** The offer itself, e.g. "Get up to 25% off". */
    highlight: { type: String, required: true, trim: true, maxlength: 60 },

    type: { type: String, enum: PROMOTION_TYPES, required: true, index: true },

    /** Which surface this belongs to. */
    placement: { type: String, enum: PLACEMENTS, default: 'offers', index: true },

    /** Longer supporting copy. Used by hero slides; optional for offer cards. */
    body: { type: String, trim: true, maxlength: 300 },

    image: { type: String, required: true },

    ctaLabel: { type: String, trim: true, maxlength: 30, default: 'Order Now' },
    ctaHref: { type: String, trim: true, default: '/menu' },

    /**
     * Scheduling.
     *
     * Both optional: an open-ended offer has neither, a countdown has both.
     * Liveness is computed from these at query time — see the service. There is
     * deliberately no `isLive` flag maintained by a job, because such a flag is
     * wrong for exactly as long as the job is down, and nobody notices until a
     * finished campaign is still selling on the homepage.
     */
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    /** Manual override — lets the owner pull a live campaign immediately. */
    isActive: { type: Boolean, default: true, index: true },

    /** Lower sorts first, so the owner controls the running order. */
    displayOrder: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// The storefront query: active, in window, in display order.
promotionSchema.index({ placement: 1, isActive: 1, startsAt: 1, endsAt: 1, displayOrder: 1 });

/**
 * Guard against a window that can never open.
 * Catching this on save means the owner is told at the point of the mistake,
 * rather than wondering next week why the campaign never appeared.
 */
promotionSchema.pre('validate', function ensureValidWindow(next) {
  if (this.startsAt && this.endsAt && this.startsAt >= this.endsAt) {
    this.invalidate('endsAt', 'The end date must be after the start date');
  }
  next();
});

export const Promotion = mongoose.model('Promotion', promotionSchema);
export default Promotion;
