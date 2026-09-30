import mongoose from 'mongoose';
import slugify from 'slugify';

/**
 * A preparation station — "Kitchen", "Chicken Counter", "Bakery".
 *
 * Each station has its own screen (/kitchen?station=<slug>) and receives the
 * order lines whose category it owns. Exactly one station is the catch-all
 * (`isDefault`) for lines whose category no station claims.
 */

export const STATION_COLORS = Object.freeze([
  '#f97316',
  '#ef4444',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]);

const stationSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name the station'], trim: true, maxlength: 40 },
    slug: { type: String, unique: true, index: true, lowercase: true },
    color: { type: String, default: STATION_COLORS[0], match: /^#[0-9a-f]{6}$/i },
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

stationSchema.index({ categories: 1 });

stationSchema.pre('validate', function setSlug() {
  if (this.isNew || this.isModified('name')) {
    this.slug = slugify(this.name ?? '', { lower: true, strict: true }) || `station-${Date.now()}`;
  }
});

export const Station = mongoose.model('Station', stationSchema);
export default Station;
