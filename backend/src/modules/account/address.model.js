/**
 * Saved delivery address.
 * ---------------------------------------------------------------------------
 * A separate collection rather than an array on the user, for the same reason
 * sessions are `select: false` there: the user document is loaded on every
 * authenticated request, and it should stay small.
 *
 * Note that orders keep their own copy of the address rather than a reference.
 * An address the customer later edits or deletes must not silently rewrite
 * where a past order was delivered.
 */
import mongoose from 'mongoose';

/** Labels from the reference design. */
export const ADDRESS_LABELS = Object.freeze(['home', 'office', 'other']);

const addressSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    label: { type: String, enum: ADDRESS_LABELS, default: 'home' },

    /** Who receives it — not always the account holder. */
    recipientName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^03\d{9}$/, 'Enter a valid mobile number (03XXXXXXXXX)'],
    },

    line1: { type: String, required: true, trim: true, maxlength: 200 },
    area: { type: String, trim: true, maxlength: 120 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    notes: { type: String, trim: true, maxlength: 300 },

    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

addressSchema.index({ customer: 1, isDefault: -1, updatedAt: -1 });

export const Address = mongoose.model('Address', addressSchema);
export default Address;
