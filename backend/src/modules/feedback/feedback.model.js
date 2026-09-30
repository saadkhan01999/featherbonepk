import mongoose from 'mongoose';

/**
 * Customer feedback — anyone's word on the whole experience.
 * ---------------------------------------------------------------------------
 * Different from a product review (reviews module), which is a signed-in
 * customer rating a dish they bought. Feedback is open to every visitor —
 * walk-in diners, guests who ordered without an account — and covers the
 * visit: the food, the service, the delivery, value for money.
 *
 *   new        arrived; only staff can see it
 *   published  on the website (the customer allowed it and staff approved it)
 *   hidden     kept for the record, never shown
 *
 * `verifiedOrder` is set when the order number they typed matches a real order,
 * so staff (and the website badge) can tell a customer from a passer-by.
 */

export const FEEDBACK_STATUS = Object.freeze(['new', 'published', 'hidden']);
export const FEEDBACK_ASPECTS = Object.freeze(['food', 'service', 'delivery', 'value']);

/**
 * One-tap tags — the quickest way to say what stood out. Keys are stored; the
 * website and the back office show the words. Good things first, then things
 * to fix, so the owner can see at a glance what people praise and what they
 * trip over.
 */
export const FEEDBACK_TAGS = Object.freeze({
  tasty: 'Tasty food',
  fresh: 'Hot & fresh',
  fast: 'Quick service',
  friendly: 'Friendly staff',
  value: 'Good value',
  portions: 'Generous portions',
  clean: 'Clean & tidy',
  packaging: 'Neat packaging',
  cold: 'Food was cold',
  slow: 'Took too long',
  wrong: 'Wrong or missing item',
  taste: 'Taste not right',
  pricey: 'Too expensive',
  small: 'Small portions',
  unfriendly: 'Unfriendly service',
  messy: 'Messy packaging',
});
export const FEEDBACK_TAG_KEYS = Object.freeze(Object.keys(FEEDBACK_TAGS));

const score = { type: Number, min: 1, max: 5 };

const feedbackSchema = new mongoose.Schema(
  {
    // Optional: the quickest feedback is a few stars and a tag. Blank shows as "A customer".
    name: { type: String, trim: true, maxlength: 80, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    orderNumber: { type: String, trim: true, uppercase: true, maxlength: 40 },
    verifiedOrder: { type: Boolean, default: false },

    rating: { ...score, required: true },
    aspects: {
      food: score,
      service: score,
      delivery: score,
      value: score,
    },
    tags: { type: [{ type: String, enum: FEEDBACK_TAG_KEYS }], default: [] },
    comment: { type: String, trim: true, maxlength: 1000, default: '' },

    /** The customer's consent to show it on the website. Staff still approve it. */
    allowPublish: { type: Boolean, default: true },
    status: { type: String, enum: FEEDBACK_STATUS, default: 'new', index: true },

    /** The owner's public reply, shown under the feedback. */
    reply: { type: String, trim: true, maxlength: 600 },
    repliedAt: { type: Date, default: null },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledByName: { type: String, default: null },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ip: { type: String, select: false },
  },
  { timestamps: true },
);

feedbackSchema.index({ status: 1, createdAt: -1 });

export const Feedback = mongoose.model('Feedback', feedbackSchema);

export default Feedback;
