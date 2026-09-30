/**
 * Page — an owner-written page on the storefront (Privacy Policy, Catering,
 * Careers, Refund Policy…).
 * ---------------------------------------------------------------------------
 * The fixed pages (Home, Menu, About, Contact) have fields tailored to them in
 * Settings. Everything else a business wants to say lives here, at /p/<slug>,
 * without anyone editing React.
 *
 * The body is text, not HTML. It uses a small, safe markdown subset (headings,
 * bold, italics, links, lists) that the storefront renders into elements
 * itself. Storing and injecting HTML would make every admin account a way to
 * put script on the public site — a stored-XSS hole opened on purpose.
 */
import mongoose from 'mongoose';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const pageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 60,
      match: [SLUG_PATTERN, 'Use lowercase letters, numbers and hyphens'],
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 240, default: '' },
    heroImage: { type: String, default: '' },
    body: { type: String, default: '', maxlength: 20_000 },
    seoDescription: { type: String, trim: true, maxlength: 200, default: '' },

    showInHeader: { type: Boolean, default: false },
    showInFooter: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: false, index: true },
    displayOrder: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

pageSchema.index({ isPublished: 1, displayOrder: 1 });

export const Page = mongoose.model('Page', pageSchema);
export default Page;
