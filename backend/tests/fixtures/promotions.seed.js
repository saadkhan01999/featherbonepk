/**
 * Promotion seed — the campaigns that used to be constants in OffersPage.jsx.
 * ---------------------------------------------------------------------------
 * Seeded verbatim so nothing disappears from the storefront when the page
 * switches from hard-coded data to the API. They now carry real schedules that
 * the owner can edit.
 *
 * Idempotent: keyed on title, so re-running updates rather than duplicating.
 */
import { Promotion } from '../../src/modules/promotions/promotion.model.js';
import { logger } from '../../src/core/utils/logger.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Dates are relative to seed time rather than fixed, so a development database
 * seeded months from now still has a live campaign and a scheduled one to look
 * at. Hard-coded dates would all be in the past and every offer would render as
 * expired.
 */
function buildCampaigns(now) {
  return [
    {
      kicker: 'Eid Special',
      title: 'Family Combo',
      highlight: 'Get up to 25% OFF',
      type: 'eid',
      image: '/images/products/photos/combos.jpg',
      displayOrder: 1,
      // Open-ended: runs until someone pauses it.
      startsAt: null,
      endsAt: null,
    },
    {
      kicker: 'Weekend Deal',
      title: 'BBQ Platter',
      highlight: 'Flat 20% OFF',
      type: 'weekend',
      image: '/images/products/photos/bbq.jpg',
      displayOrder: 2,
      startsAt: new Date(now - 2 * DAY),
      endsAt: new Date(now + 5 * DAY),
    },
    {
      kicker: 'Combo Deal',
      title: 'Roast & Naan',
      highlight: 'Save Rs 300',
      type: 'combo',
      image: '/images/products/photos/roast-chicken.jpg',
      displayOrder: 3,
      startsAt: null,
      endsAt: null,
    },
    {
      kicker: 'Seasonal',
      title: 'Dessert Box',
      highlight: 'Buy 1 Get 1',
      type: 'seasonal',
      image: '/images/products/photos/sweets.jpg',
      displayOrder: 4,
      startsAt: null,
      endsAt: null,
    },
    {
      // Deliberately future-dated: gives the admin screen a "scheduled" row, and
      // proves the storefront hides offers that have not started.
      kicker: 'Coming Soon',
      title: 'Ramadan Iftar Deal',
      highlight: 'Bundle from Rs 1,999',
      type: 'seasonal',
      image: '/images/products/photos/combos.jpg',
      displayOrder: 5,
      startsAt: new Date(now + 14 * DAY),
      endsAt: new Date(now + 44 * DAY),
    },

    /*
     * Hero slides.
     *
     * Same model, different placement. These were a hard-coded array in
     * HomePage.jsx, so changing the homepage banner needed a developer and a
     * deploy. They now schedule and expire like any other campaign.
     */
    {
      placement: 'hero',
      kicker: 'Taste the Best',
      title: 'Delicious Food',
      highlight: 'Order Now',
      body: 'We serve the best roasted chicken, meat, bakery & sweets with premium quality and perfect taste.',
      type: 'seasonal',
      image: '/images/products/photos/roast-chicken.jpg',
      ctaLabel: 'Order Now',
      ctaHref: '/menu',
      displayOrder: 1,
      startsAt: null,
      endsAt: null,
    },
    {
      placement: 'hero',
      kicker: 'Fresh from the Grill',
      title: 'Smoky BBQ',
      highlight: 'Explore the Grill',
      body: 'Charcoal-grilled kababs and platters, prepared to order by our expert chefs.',
      type: 'weekend',
      image: '/images/products/photos/bbq.jpg',
      ctaLabel: 'See the Menu',
      ctaHref: '/menu',
      displayOrder: 2,
      startsAt: null,
      endsAt: null,
    },
    {
      placement: 'hero',
      kicker: 'Made for Sharing',
      title: 'Family Combos',
      highlight: 'Feed Everyone',
      body: 'Generous platters that bring everyone to the table — at a price that makes sense.',
      type: 'combo',
      image: '/images/products/photos/combos.jpg',
      ctaLabel: 'Browse Combos',
      ctaHref: '/menu',
      displayOrder: 3,
      startsAt: null,
      endsAt: null,
    },
  ];
}

export async function seedPromotions() {
  const campaigns = buildCampaigns(Date.now());
  let created = 0;

  for (const campaign of campaigns) {
    const result = await Promotion.updateOne(
      // Keyed on title and placement: a hero slide and an offer card may
      // legitimately share a title, and title alone would collapse them.
      { title: campaign.title, placement: campaign.placement ?? 'offers' },
      { $setOnInsert: campaign },
      { upsert: true },
    );
    if (result.upsertedCount > 0) created += 1;
  }

  if (created > 0) logger.info(`Seeded ${created} promotional campaign(s)`);
  return `promotions: ${created} created, ${campaigns.length - created} already present`;
}

export default seedPromotions;
