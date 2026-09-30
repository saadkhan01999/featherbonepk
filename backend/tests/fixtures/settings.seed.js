/**
 * Settings seed — the business's own identity.
 * ---------------------------------------------------------------------------
 * Only writes values that are still at their code default, so an owner's edit
 * in the back office is never overwritten by a later restart. That distinction
 * matters: a seed that clobbers live configuration is worse than no seed, and
 * the failure only shows up after someone has already changed something.
 *
 * What belongs here, and what must not.
 *
 * Only facts that are actually true about this business. Anything invented — a
 * placeholder phone number, a stand-in payment ID — must stay out, because a
 * seeded value is indistinguishable from one the owner chose. It then reaches
 * customers without anyone having decided to publish it. A blank field is
 * visibly blank and gets filled in; a plausible wrong one never does.
 *
 * This file previously seeded a JazzCash Till ID. That is the number customers
 * scan to send money to, and it belonged to nobody — every install would have
 * shown it on the counter.
 */
import { settingsService } from '../../src/modules/settings/settings.service.js';
import { logger } from '../../src/core/utils/logger.js';

/**
 * The business this system was built for.
 *
 * Running it for a different shop? Change these, or leave them blank and set
 * them under Settings → Business Details, which is where they are meant to be
 * edited. Payment identifiers are deliberately absent: the Till ID is money
 * routing and must be typed in by the person whose account receives it.
 */
const DEFAULTS = {
  business: {
    businessName: 'Feather & Bone',
    businessTagline: 'Roast · Meat · Sweets · Bakery',
    businessAddress: 'Chota Chowk, Mardan, Khyber Pakhtunkhwa, Pakistan',
    businessPhone: '+92 315 2989005',
  },
};

export async function seedSettings() {
  let written = 0;

  for (const [section, values] of Object.entries(DEFAULTS)) {
    const updates = {};

    for (const [key, value] of Object.entries(values)) {
      // Only fill a field the owner has not set. `get` returns the stored
      // override when one exists, otherwise the code default.
      const current = settingsService.get(key);
      if (!current) updates[key] = value;
    }

    if (Object.keys(updates).length > 0) {
      await settingsService.update(section, updates);
      written += Object.keys(updates).length;
    }
  }

  if (written > 0) logger.info(`Seeded ${written} business setting(s)`);
  return `settings: ${written} written, rest already configured`;
}

export default seedSettings;
