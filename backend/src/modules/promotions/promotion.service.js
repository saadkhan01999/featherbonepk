/**
 * Promotions.
 * ---------------------------------------------------------------------------
 * The rule that matters: what is "live" is decided by the database query at the
 * moment of the request, never by a stored flag.
 *
 * A `isLive` boolean flipped by a scheduled job is wrong for as long as the job
 * is down or the clock drifts, and the failure is invisible — a finished Eid
 * campaign quietly keeps selling. Comparing dates in the query cannot drift,
 * because there is nothing to keep in sync.
 */
import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { Promotion, PROMOTION_TYPES, PLACEMENTS } from './promotion.model.js';

/**
 * Mongo filter for "showing right now".
 * A null bound means open-ended in that direction, hence the $or on each side.
 */
function liveFilter(now = new Date(), placement = 'offers') {
  return {
    placement,
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  };
}

/** Shape for the storefront — scheduling internals are not the public's business. */
function toPublic(promotion) {
  return {
    id: String(promotion._id),
    type: promotion.type,
    kicker: promotion.kicker,
    title: promotion.title,
    highlight: promotion.highlight,
    body: promotion.body ?? null,
    placement: promotion.placement ?? 'offers',
    image: promotion.image,
    ctaLabel: promotion.ctaLabel,
    ctaHref: promotion.ctaHref,
    // Only forward-looking: a countdown is useful, a start date that has
    // already passed is noise.
    endsAt: promotion.endsAt ?? null,
  };
}

/** Derived state for the admin table. */
function scheduleState(promotion, now = new Date()) {
  if (!promotion.isActive) return 'paused';
  if (promotion.startsAt && promotion.startsAt > now) return 'scheduled';
  if (promotion.endsAt && promotion.endsAt <= now) return 'expired';
  return 'live';
}

export const promotionService = {
  /** Currently-showing banners for one surface, for the storefront. */
  async listLive(placement = 'offers') {
    const promotions = await Promotion.find(liveFilter(new Date(), placement))
      .sort({ displayOrder: 1, createdAt: -1 })
      .lean();
    return promotions.map(toPublic);
  },

  /** Everything, with derived schedule state — for the back office. */
  async listAll({ type, state, placement } = {}) {
    const filter = {};
    if (type) filter.type = type;
    if (placement) filter.placement = placement;

    const promotions = await Promotion.find(filter).sort({ displayOrder: 1, createdAt: -1 }).lean();

    const now = new Date();
    const rows = promotions.map((promotion) => ({
      ...toPublic(promotion),
      startsAt: promotion.startsAt ?? null,
      endsAt: promotion.endsAt ?? null,
      isActive: promotion.isActive,
      displayOrder: promotion.displayOrder,
      state: scheduleState(promotion, now),
      createdAt: promotion.createdAt,
    }));

    // Filtered after mapping because `state` is derived, not stored — there is
    // nothing to match on in the query.
    return state ? rows.filter((row) => row.state === state) : rows;
  },

  async create(data, actorId) {
    const promotion = await Promotion.create({ ...data, createdBy: actorId, updatedBy: actorId });
    logger.info('Promotion created', { id: String(promotion._id), title: promotion.title });
    /*
     * Return the saved record, not just an id.
     *
     * `placement` has a server-side default, so a client that sends 'hero' and
     * gets back only `{ id, message }` cannot tell whether the field was
     * honoured, ignored, or quietly stripped by validation. Echoing what was
     * actually stored makes that visible at the point it is decided instead of
     * on the next page load.
     */
    return { ...toPublic(promotion), message: `"${promotion.title}" saved` };
  },

  async update(id, data, actorId) {
    const promotion = await Promotion.findById(id);
    if (!promotion) throw ApiError.notFound('Offer');

    Object.assign(promotion, data, { updatedBy: actorId });
    await promotion.save();

    logger.info('Promotion updated', { id, title: promotion.title });
    return { ...toPublic(promotion), message: `"${promotion.title}" updated` };
  },

  async remove(id) {
    const promotion = await Promotion.findByIdAndDelete(id);
    if (!promotion) throw ApiError.notFound('Offer');
    logger.info('Promotion deleted', { id, title: promotion.title });
    return { id, message: `"${promotion.title}" deleted` };
  },

  /** Counts for the admin summary. */
  async stats() {
    const all = await Promotion.find().select('isActive startsAt endsAt').lean();
    const now = new Date();
    const counts = { live: 0, scheduled: 0, expired: 0, paused: 0 };
    for (const promotion of all) counts[scheduleState(promotion, now)] += 1;
    return { ...counts, total: all.length };
  },

  types: PROMOTION_TYPES,
  placements: PLACEMENTS,
};

export default promotionService;
