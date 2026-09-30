/**
 * Business settings.
 * ---------------------------------------------------------------------------
 * Defaults live in code; the database stores only overrides.
 *
 * That split matters: a new setting needs no migration, and a missing or
 * corrupt row degrades to the shipped value instead of leaving `undefined`
 * halfway through a price calculation. A blank tax rate must never silently
 * become "no tax".
 *
 * Values are cached in memory and read synchronously, because pricing runs on
 * the hot path of every cart quote and every POS sale — adding a database round
 * trip there would slow the till on every keystroke.
 *
 * The registry drives the admin screens. Every field below declares its type,
 * label, limits and help text; the back office renders its forms from this
 * description and the server validates against the same one. Adding a setting
 * here is all it takes for it to appear, be validated and take effect.
 *
 * Field types
 *   string   one line of text          text     several lines of text
 *   number   with min/max, optional unit ('percent' is stored as a fraction)
 *   boolean  a switch                  select   one of `options`
 *   color    #rrggbb                   url      http(s), mailto:, tel: or a /path
 *   image    an uploaded or pasted image path    video   likewise, for video
 *   list     a repeatable group of `itemFields`, at most `maxItems` rows
 *   schedule a weekly timetable: { mon: { open, close, closed }, … sun }
 *
 * `group` decides which screen shows the section: 'operations' → Settings,
 * 'website' → Website Management. Both screens edit the same store.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { DEFAULT_SCHEDULE, cleanSchedule, hoursStatus, scheduleSummary } from './opening-hours.js';

/* ------------------------------------------------------------------------ */
/* Shared option lists                                                       */
/* ------------------------------------------------------------------------ */

const THEME_MODES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** Platforms the footer knows an icon for. `website` and `other` get a globe. */
export const SOCIAL_PLATFORMS = Object.freeze([
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other' },
]);

/** How the homepage carousel moves from one slide to the next. */
const SLIDER_EFFECTS = [
  { value: 'book', label: 'Book — the page turns' },
  { value: 'cube', label: '3D cube' },
  { value: 'coverflow', label: 'Cover flow — cards swing past' },
  { value: 'kenburns', label: 'Cinematic zoom (Ken Burns)' },
  { value: 'slide', label: 'Slide with parallax' },
];

const SLIDER_HEIGHTS = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'tall', label: 'Tall' },
  { value: 'screen', label: 'Full screen' },
];

const TEXT_ALIGN = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

/** Icons for the homepage "Why Choose Us" cards. */
const HIGHLIGHT_ICONS = [
  { value: 'shield', label: 'Shield (hygiene, safety)' },
  { value: 'leaf', label: 'Leaf (fresh)' },
  { value: 'chef', label: 'Chef hat' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'truck', label: 'Delivery' },
  { value: 'clock', label: 'Clock (fast)' },
  { value: 'heart', label: 'Heart' },
  { value: 'star', label: 'Star' },
  { value: 'flame', label: 'Flame (grill)' },
  { value: 'award', label: 'Award' },
];

/** Icons a custom footer/contact field may carry. */
const FIELD_ICONS = [
  { value: 'info', label: 'Info' },
  { value: 'phone', label: 'Phone' },
  { value: 'mail', label: 'Email' },
  { value: 'map', label: 'Location' },
  { value: 'clock', label: 'Hours' },
  { value: 'store', label: 'Branch' },
  { value: 'truck', label: 'Delivery' },
  { value: 'card', label: 'Payment' },
];

/**
 * The settings registry. Adding an entry here is all that is needed for it to
 * appear in the admin UI, be validated, and take effect.
 */
export const SETTINGS_SCHEMA = Object.freeze({
  tax: {
    label: 'Tax & GST',
    description: 'Applied to online orders and at the till.',
    group: 'operations',
    fields: {
      taxRate: {
        label: 'GST Rate',
        // Stored as a fraction (0.05), displayed as a percent (5%).
        // This is the classic hundredfold bug: someone types 17 meaning 17%
        // and it is stored as 1700%. The unit is declared here so the UI can
        // scale it and validation can reject nonsense.
        unit: 'percent',
        type: 'number',
        default: 0.05,
        min: 0,
        max: 1,
        help: 'Percentage added to the order total. Enter 5 for 5%.',
      },
      taxInclusive: {
        label: 'Prices include tax',
        type: 'boolean',
        default: false,
        help: 'When on, menu prices already contain GST and it is not added again.',
      },
      taxLabel: {
        label: 'Tax label on receipts',
        type: 'string',
        default: 'GST',
        help: 'Shown on the printed slip and invoices.',
      },
    },
  },
  /*
   * Business identity.
   *
   * Printed on every receipt and shown in the storefront footer. It was
   * hard-coded into the slip component as "Main Pabbi Road, Mardan" and a phone
   * number — so a different business running this software printed someone
   * else's address on every sale, and only a developer could correct it.
   */
  business: {
    label: 'Business Details',
    description: 'Your name, logo and contact details — printed on receipts and shown to customers.',
    group: 'website',
    fields: {
      businessName: { label: 'Business Name', type: 'string', default: 'Feather & Bone', maxLength: 80 },
      businessTagline: {
        label: 'Tagline',
        type: 'string',
        default: 'Roast | Meat | Sweets | Bakery',
        maxLength: 120,
      },
      /**
       * The logo, everywhere: storefront header and footer, back office, till,
       * kitchen display and the printed receipt. Blank keeps the flame mark.
       */
      logoUrl: {
        label: 'Logo',
        type: 'image',
        default: '',
        help: 'Square or wide PNG with a transparent background works best. Shown on the site, the till, the kitchen screen and receipts.',
      },
      businessAddress: { label: 'Address', type: 'string', default: '', maxLength: 240 },
      businessPhone: { label: 'Phone', type: 'string', default: '', maxLength: 40 },
      businessEmail: { label: 'Email', type: 'string', default: '', maxLength: 120 },
      /** Shown at the bottom of every slip — "Thank you", return policy, hours. */
      receiptFooter: {
        label: 'Receipt Footer Message',
        type: 'string',
        default: 'Thank you for your custom!',
        maxLength: 200,
      },
      /** Optional: a tax/NTN number many jurisdictions require on a receipt. */
      taxNumber: { label: 'Tax / NTN Number', type: 'string', default: '', maxLength: 60 },
      businessHours: {
        label: 'Opening Hours',
        type: 'string',
        default: '',
        maxLength: 120,
        help: 'Free text, only a fallback. The footer and Contact page show the weekly timetable from Website Management → Opening Hours & Online Orders — set your hours there.',
      },
      /*
       * The original four social fields: blank by default and hidden when blank.
       * Kept for compatibility — Footer → Social links takes any number more.
       */
      socialFacebook: { label: 'Facebook URL', type: 'url', default: '' },
      socialInstagram: { label: 'Instagram URL', type: 'url', default: '' },
      socialTiktok: { label: 'TikTok URL', type: 'url', default: '' },
      socialWhatsapp: {
        label: 'WhatsApp Number',
        type: 'string',
        default: '',
        maxLength: 20,
        help: 'International format without symbols, e.g. 923001234567.',
      },
    },
  },

  /*
   * Theme — colour and light/dark, per surface.
   *
   * One brand colour drives every accent (buttons, active navigation, prices,
   * focus rings). Each surface picks its own mode because they live in
   * different light: a kitchen screen by a hot line, a till by a window, a
   * back office in an office.
   */
  theme: {
    label: 'Theme & Colours',
    description: 'Your brand colour, and light or dark mode for each screen.',
    group: 'website',
    fields: {
      brandColor: {
        label: 'Brand Colour',
        type: 'color',
        default: '#f9b416',
        help: 'Buttons, highlights and prices use this colour everywhere.',
      },
      websiteMode: { label: 'Website', type: 'select', options: THEME_MODES, default: 'dark' },
      adminMode: { label: 'Back Office', type: 'select', options: THEME_MODES, default: 'dark' },
      posMode: { label: 'Till (POS)', type: 'select', options: THEME_MODES, default: 'dark' },
      kitchenMode: { label: 'Kitchen & Order Board', type: 'select', options: THEME_MODES, default: 'dark' },
    },
  },

  /*
   * Opening hours — when the shop is open, and whether the website takes orders
   * outside those times. Checked by the server when an order is placed, in
   * Pakistan time, so a stale browser tab or a clock set wrong on a customer's
   * phone cannot place an order at 3 am. The website shows the same status
   * before anyone fills in their details.
   */
  hours: {
    label: 'Opening Hours & Online Orders',
    description: 'Your weekly hours, and what the website does when you are closed.',
    group: 'website',
    fields: {
      openingHours: {
        label: 'Weekly opening hours',
        type: 'schedule',
        default: DEFAULT_SCHEDULE,
        help:
          'Pakistan time. A closing time earlier than the opening time runs past midnight (18:00 to 02:00). ' +
          'The same opening and closing time means open 24 hours.',
      },
      hoursEnforceOnline: {
        label: 'Only accept website orders while open',
        type: 'boolean',
        default: true,
        help: 'Off: the website takes orders at any time. Till sales are never affected.',
      },
      hoursLastOrderMinutes: {
        label: 'Stop taking website orders before closing (minutes)',
        type: 'number',
        default: 0,
        min: 0,
        max: 240,
        help: 'e.g. 30 — the last order is 30 minutes before you close, so the kitchen can finish it.',
      },
      hoursTemporarilyClosed: {
        label: 'Closed right now (holiday, power cut, fully booked)',
        type: 'boolean',
        default: false,
        help: 'Stops website orders immediately, whatever the hours say. Remember to switch it off again.',
      },
      hoursClosedTitle: {
        label: 'Heading shown when closed',
        type: 'string',
        default: "We're closed right now",
        maxLength: 80,
      },
      hoursClosedMessage: {
        label: 'Message shown when closed',
        type: 'text',
        default:
          'Our kitchen is resting for now. Browse the menu and fill your basket — it will be saved, ' +
          'and we will be ready to cook the moment we open.',
        maxLength: 300,
      },
    },
  },

  /*
   * The homepage carousel — up to five pictures, straight under the menu bar.
   * The owner uploads the images, writes the words on each, and picks how the
   * slides change. An empty list falls back to the homepage hero in Website
   * Content, so a new site is never blank at the top.
   */
  slider: {
    label: 'Homepage Slider',
    description: 'Up to five pictures at the top of the homepage, with your words and buttons on each.',
    group: 'website',
    fields: {
      sliderSlides: {
        label: 'Slides',
        type: 'list',
        maxItems: 5,
        default: [],
        help: 'Best size: 1920 × 900 pixels (landscape). The words sit on a dark shade, so any photo stays readable.',
        itemFields: {
          image: { label: 'Picture', type: 'image', required: true },
          kicker: { label: 'Small line above the title', type: 'string', maxLength: 60 },
          title: { label: 'Title', type: 'string', maxLength: 80 },
          body: { label: 'Text', type: 'text', maxLength: 240 },
          ctaLabel: { label: 'Button text', type: 'string', maxLength: 30 },
          ctaHref: { label: 'Button link', type: 'url', help: 'e.g. /menu, /offers or /p/catering' },
          align: { label: 'Text position', type: 'select', options: TEXT_ALIGN, default: 'left' },
        },
      },
      sliderEffect: { label: 'Transition', type: 'select', options: SLIDER_EFFECTS, default: 'book' },
      sliderInterval: {
        label: 'Seconds per slide',
        type: 'number',
        default: 6,
        min: 3,
        max: 30,
      },
      sliderAutoplay: { label: 'Play automatically', type: 'boolean', default: true },
      sliderHeight: { label: 'Height', type: 'select', options: SLIDER_HEIGHTS, default: 'standard' },
      sliderCalmForReducedMotion: {
        label: 'Calmer slides for visitors who ask for less motion',
        type: 'boolean',
        default: false,
        help:
          'On: phones and PCs set to "reduce animations" (Windows: Show animations off) get a gentle fade and no ' +
          'auto-play. Off: everyone sees the transition you chose.',
      },
    },
  },

  content: {
    label: 'Website Content',
    description: 'Hero banner, story video and headline copy on the storefront.',
    group: 'website',
    fields: {
      heroKicker: { label: 'Hero Line 1', type: 'string', default: 'Taste the Best', maxLength: 80 },
      heroTitle: { label: 'Hero Line 2 (gold)', type: 'string', default: 'Delicious Food', maxLength: 80 },
      heroBody: {
        label: 'Hero Description',
        type: 'text',
        maxLength: 400,
        default:
          'We serve the best roasted chicken, meat, bakery & sweets with premium quality and perfect taste.',
      },
      heroImage: {
        label: 'Hero Background Image',
        type: 'image',
        default: '/images/products/photos/roast-chicken.jpg',
        help: 'Upload a new banner or paste a path. Shown behind the homepage headline.',
      },
      storyVideoUrl: {
        label: 'Story Video',
        type: 'video',
        default: '/video/restaurant-story.mp4',
        help: 'Autoplays muted on the homepage. MP4 (H.264) works everywhere.',
      },
      storyPosterUrl: {
        label: 'Video Poster Image',
        type: 'image',
        default: '/video/restaurant-story-poster.jpg',
        help: 'Shown before the video decodes its first frame.',
      },
      storyHeading: {
        label: 'Story Heading',
        type: 'string',
        default: 'Our Restaurant Story',
        maxLength: 80,
      },
      storyBody: {
        label: 'Story Text',
        type: 'text',
        maxLength: 400,
        default: 'We are committed to providing you with the best quality food. Watch our story.',
      },

      /*
       * "Why choose us" — the homepage cards. They were hard-coded in the page
       * ("Expert Chefs", "Great Ambience"…), so every business running this
       * software made the same claims and none could change them. Now the
       * owner writes them; an empty list hides the section.
       */
      whyHeading: {
        label: '"Why Choose Us" heading',
        type: 'string',
        default: 'Why Choose Us',
        maxLength: 80,
      },
      whyChooseUs: {
        label: '"Why Choose Us" cards',
        type: 'list',
        maxItems: 8,
        help: 'The cards under the best sellers on the homepage. Remove them all to hide the section.',
        default: [
          { icon: 'shield', title: 'Hygienic Food', body: 'Prepared to strict hygiene standards.' },
          { icon: 'leaf', title: 'Fresh Ingredients', body: 'Bought fresh and cooked the same day.' },
          { icon: 'chef', title: 'Made to Order', body: 'Every order prepared when you place it.' },
          { icon: 'sparkles', title: 'Family Friendly', body: 'A comfortable place for the whole family.' },
        ],
        itemFields: {
          icon: { label: 'Icon', type: 'select', options: HIGHLIGHT_ICONS, default: 'star' },
          title: { label: 'Title', type: 'string', required: true, maxLength: 40 },
          body: { label: 'Text', type: 'text', required: true, maxLength: 160 },
        },
      },
    },
  },

  /*
   * About page — everything on /about, in the order it appears there.
   *
   * Its own section, so saving the homepage never overwrites a half-edited
   * About story (values saved under `content` earlier still resolve — see
   * FIELD_OWNER). Anything left empty is not shown; the figures default to
   * empty so the page never makes claims the owner did not write.
   */
  about: {
    label: 'About Page',
    description:
      'Everything on the About Us page, top to bottom. Parts you leave empty are simply not shown.',
    group: 'website',
    fields: {
      aboutHeading: {
        label: 'Big heading',
        type: 'string',
        default: 'The story behind our food',
        maxLength: 80,
      },
      aboutLead: {
        label: 'Short introduction',
        type: 'text',
        default: '',
        maxLength: 300,
        help: 'One or two sentences under the heading. Blank uses your tagline.',
      },
      aboutImage: {
        label: 'Main picture',
        type: 'image',
        default: '',
        help: 'The large picture at the top. Blank uses your homepage hero picture.',
      },
      aboutImage2: {
        label: 'Second picture',
        type: 'image',
        default: '',
        help: 'A smaller picture overlapping the first — the kitchen, a dish, your team. Optional.',
      },
      aboutSince: {
        label: 'Open since (year)',
        type: 'string',
        default: '',
        maxLength: 20,
        help: 'For example 2019 — shown as a "Since 2019" badge. Leave blank to hide it.',
      },
      aboutBody: {
        label: 'Your story',
        type: 'text',
        default: '',
        maxLength: 3000,
        help: 'How it started, what you cook, what you care about. A blank line starts a new paragraph.',
      },
      aboutQuote: {
        label: 'A quote (optional)',
        type: 'text',
        default: '',
        maxLength: 300,
        help: 'Words from the owner or chef, shown large beside your story.',
      },
      aboutQuoteBy: {
        label: 'Quote by',
        type: 'string',
        default: '',
        maxLength: 80,
        help: 'For example "Saad — founder".',
      },
      aboutStat1Value: {
        label: 'Figure 1 — number',
        type: 'string',
        default: '',
        maxLength: 20,
        help: 'Only figures with a number are shown — for example "12" with "Dishes on the menu".',
      },
      aboutStat1Label: {
        label: 'Figure 1 — caption',
        type: 'string',
        default: 'Years of Experience',
        maxLength: 40,
      },
      aboutStat2Value: { label: 'Figure 2 — number', type: 'string', default: '', maxLength: 20 },
      aboutStat2Label: {
        label: 'Figure 2 — caption',
        type: 'string',
        default: 'Items on the Menu',
        maxLength: 40,
      },
      aboutStat3Value: { label: 'Figure 3 — number', type: 'string', default: '', maxLength: 20 },
      aboutStat3Label: {
        label: 'Figure 3 — caption',
        type: 'string',
        default: 'Happy Customers',
        maxLength: 40,
      },
      aboutStat4Value: { label: 'Figure 4 — number', type: 'string', default: '', maxLength: 20 },
      aboutStat4Label: { label: 'Figure 4 — caption', type: 'string', default: 'Branches', maxLength: 40 },

      aboutStepsHeading: {
        label: '"How we work" heading',
        type: 'string',
        default: 'From our kitchen to your table',
        maxLength: 80,
      },
      aboutSteps: {
        label: '"How we work" steps',
        type: 'list',
        maxItems: 6,
        help: 'Numbered steps across the page. Remove them all to hide the section.',
        // Each one describes how orders really move through this system.
        default: [
          { title: 'You order', body: 'At the counter or on this website — whichever suits you.' },
          {
            title: 'Straight to the kitchen',
            body: 'Your order reaches our kitchen screen the moment it is placed.',
          },
          { title: 'Cooked for you', body: 'Prepared when you order, not hours before.' },
          {
            title: 'Ready to enjoy',
            body: 'Collect it when your number shows as Ready, or we bring it to your door.',
          },
        ],
        itemFields: {
          title: { label: 'Title', type: 'string', required: true, maxLength: 40 },
          body: { label: 'Text', type: 'text', required: true, maxLength: 200 },
        },
      },

      aboutSections: {
        label: 'Story chapters',
        type: 'list',
        maxItems: 8,
        default: [],
        help: 'Picture-and-text chapters — "Our Kitchen", "Our Promise", "Our Recipes".',
        itemFields: {
          heading: { label: 'Heading', type: 'string', required: true, maxLength: 80 },
          body: { label: 'Text', type: 'text', required: true, maxLength: 1500 },
          image: { label: 'Picture', type: 'image' },
        },
      },

      aboutTimelineHeading: {
        label: 'Timeline heading',
        type: 'string',
        default: 'Our journey',
        maxLength: 80,
      },
      aboutTimeline: {
        label: 'Timeline',
        type: 'list',
        maxItems: 12,
        default: [],
        help: 'Milestones, oldest first — "2019 · Opened our first counter". Empty hides the timeline.',
        itemFields: {
          year: { label: 'Year or date', type: 'string', required: true, maxLength: 20 },
          title: { label: 'What happened', type: 'string', required: true, maxLength: 80 },
          body: { label: 'A little more (optional)', type: 'text', maxLength: 400 },
        },
      },

      aboutTeamHeading: {
        label: 'Team heading',
        type: 'string',
        default: 'The people behind the food',
        maxLength: 80,
      },
      aboutTeam: {
        label: 'Team',
        type: 'list',
        maxItems: 12,
        default: [],
        help: 'Portraits with a name and role. Empty hides the section.',
        itemFields: {
          name: { label: 'Name', type: 'string', required: true, maxLength: 60 },
          role: { label: 'Role', type: 'string', maxLength: 60 },
          photo: { label: 'Photo', type: 'image' },
        },
      },

      aboutGalleryHeading: {
        label: 'Gallery heading',
        type: 'string',
        default: 'A look inside',
        maxLength: 80,
      },
      aboutGallery: {
        label: 'Gallery',
        type: 'list',
        maxItems: 12,
        default: [],
        help: 'Photos of your place, kitchen and food. Empty shows photos from your menu instead.',
        itemFields: {
          image: { label: 'Photo', type: 'image', required: true },
          caption: { label: 'Caption', type: 'string', maxLength: 80 },
        },
      },

      aboutShowVisit: {
        label: 'Show "Come and visit" at the bottom',
        type: 'boolean',
        default: true,
        help: 'Your address, phone and opening hours, taken from Business details and Opening Hours.',
      },
    },
  },

  contact: {
    label: 'Contact Page',
    description: 'What the Contact Us page says and shows.',
    group: 'website',
    fields: {
      contactImage: {
        label: 'Banner picture',
        type: 'image',
        default: '',
        help: 'The wide picture behind the heading at the top of the page. Blank uses your homepage hero picture.',
      },
      contactBannerShade: {
        label: 'Banner darkness',
        type: 'select',
        options: [
          { value: 'light', label: 'Light — for darker photos' },
          { value: 'medium', label: 'Medium (recommended)' },
          { value: 'dark', label: 'Dark — for bright, busy photos' },
        ],
        default: 'medium',
        help: 'How much the picture is darkened so the heading stays easy to read.',
      },
      contactBannerLabel: {
        label: 'Small label above the heading',
        type: 'string',
        default: 'Contact Us',
        maxLength: 40,
        help: 'Leave blank to hide it.',
      },
      contactHeading: { label: 'Heading', type: 'string', default: 'Get in Touch', maxLength: 80 },
      contactIntro: {
        label: 'Introduction',
        type: 'text',
        default: 'Questions, bulk orders or feedback — we read every message.',
        maxLength: 500,
      },
      contactShowForm: { label: 'Show the message form', type: 'boolean', default: true },
      contactShowMap: { label: 'Show a map', type: 'boolean', default: true },
      contactMapQuery: {
        label: 'Map location',
        type: 'string',
        default: '',
        maxLength: 200,
        help: 'An address or "lat,long" for the map pin. Blank uses the business address.',
      },
      contactNotifyEmail: {
        label: 'Send messages to',
        type: 'string',
        default: '',
        maxLength: 120,
        help: 'Email that receives contact-form messages. Blank uses the business email.',
      },
    },
  },

  /*
   * Footer — links, social icons and custom fields the owner adds.
   *
   * Custom fields are free label/value pairs ("Second Branch", "Catering",
   * "Halal certificate no.") shown in the footer and/or on the Contact page, so
   * an owner can publish a detail the schema did not anticipate without a
   * developer adding a column for it.
   */
  footer: {
    label: 'Footer & Social',
    description: 'Footer text, social icons, extra links and your own custom fields.',
    group: 'website',
    fields: {
      footerAbout: {
        label: 'Footer Blurb',
        type: 'text',
        default: '',
        maxLength: 300,
        help: 'A sentence or two under your logo in the footer. Blank uses the tagline.',
      },
      copyrightText: {
        label: 'Copyright Line',
        type: 'string',
        default: '',
        maxLength: 160,
        help: 'Blank shows "© <year> <business name>. All rights reserved."',
      },
      socialLinks: {
        label: 'Social Links',
        type: 'list',
        maxItems: 12,
        default: [],
        help: 'Any number of social profiles. Each shows as an icon in the footer.',
        itemFields: {
          platform: { label: 'Platform', type: 'select', options: SOCIAL_PLATFORMS, required: true },
          url: { label: 'Link', type: 'url', required: true },
          label: { label: 'Label (optional)', type: 'string', maxLength: 40 },
        },
      },
      footerLinks: {
        label: 'Footer Links',
        type: 'list',
        maxItems: 12,
        default: [],
        help: 'Extra links in the footer — e.g. "Privacy Policy" → /p/privacy.',
        itemFields: {
          label: { label: 'Text', type: 'string', required: true, maxLength: 40 },
          href: { label: 'Link', type: 'url', required: true },
        },
      },
      customFields: {
        label: 'Custom Fields',
        type: 'list',
        maxItems: 12,
        default: [],
        help: 'Your own label and value pairs, e.g. "Second Branch — Saddar Road".',
        itemFields: {
          label: { label: 'Label', type: 'string', required: true, maxLength: 40 },
          value: { label: 'Value', type: 'string', required: true, maxLength: 200 },
          icon: { label: 'Icon', type: 'select', options: FIELD_ICONS, default: 'info' },
          showInFooter: { label: 'Show in footer', type: 'boolean', default: true },
          showOnContact: { label: 'Show on Contact page', type: 'boolean', default: true },
        },
      },
    },
  },

  /*
   * Counter payments.
   *
   * The JazzCash till ID is not the same thing as the JazzCash merchant API
   * credentials. The Till ID drives a static QR: the customer scans, pays from
   * their wallet, and the payment lands in the merchant's JazzCash app. There
   * is no callback to this system, so the cashier confirms receipt — which is
   * exactly how the paper poster on the counter already works.
   *
   * Online checkout is different and needs MerchantID + Password + Integrity
   * Salt in `.env`; see the JazzCash provider.
   */
  payments: {
    label: 'Counter Payments',
    description: 'JazzCash QR details shown on the till and printed on the slip.',
    group: 'operations',
    fields: {
      jazzcashTillId: {
        label: 'JazzCash Till ID',
        type: 'string',
        default: '',
        maxLength: 40,
        help: 'From your JazzCash QR poster. Shown at the till for the customer to pay.',
      },
      jazzcashQrImage: {
        label: 'JazzCash QR Image',
        type: 'image',
        default: '',
        help: 'Upload the QR from your poster so the cashier can show it on screen.',
      },
      jazzcashMerchantName: {
        label: 'Merchant Name on QR',
        type: 'string',
        default: 'Feather & Bone',
        maxLength: 80,
      },
      jazzcashUssd: {
        label: 'USSD Code',
        type: 'string',
        default: '*786*10#',
        maxLength: 20,
        help: 'Shown as the fallback if the customer cannot scan.',
      },
    },
  },

  /*
   * The till — behaviour and the printed slip.
   *
   * The slip settings exist because thermal printers differ: the same page that
   * prints crisply on one prints grey on another. Bold and a larger size are the
   * defaults, because a slip too faint to read is a slip the customer cannot
   * use for anything.
   */
  pos: {
    label: 'Till (POS) & Receipt',
    description: 'How the till behaves and what the printed slip looks like.',
    group: 'operations',
    fields: {
      posDefaultOrderType: {
        label: 'Default order type',
        type: 'select',
        options: [
          { value: 'take_away', label: 'Take Away' },
          { value: 'dine_in', label: 'Dine In' },
        ],
        default: 'take_away',
      },
      posAskTable: {
        label: 'Ask for a table number on dine-in',
        type: 'boolean',
        default: true,
      },
      posQuickCash: {
        label: 'Quick cash buttons',
        type: 'string',
        default: '500, 1000, 2000, 5000',
        maxLength: 80,
        help: 'Notes the payment screen offers as one-tap buttons, separated by commas.',
      },
      receiptPaperWidth: {
        label: 'Receipt paper width',
        type: 'select',
        options: [
          { value: '80', label: '80 mm' },
          { value: '58', label: '58 mm' },
        ],
        default: '80',
      },
      receiptFontSize: {
        label: 'Receipt text size',
        type: 'select',
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'large', label: 'Large' },
          { value: 'xlarge', label: 'Extra large' },
        ],
        default: 'large',
      },
      receiptBold: {
        label: 'Print receipt text in bold',
        type: 'boolean',
        default: true,
        help: 'Keep on for thermal printers — regular weight often prints too faint to read.',
      },
      receiptShowLogo: { label: 'Print the logo on receipts', type: 'boolean', default: true },
      receiptShowBarcode: { label: 'Print the invoice barcode', type: 'boolean', default: true },
      receiptHeaderNote: {
        label: 'Receipt header note',
        type: 'string',
        default: '',
        maxLength: 120,
        help: 'An extra line under the address, e.g. "Free Wi-Fi: FB-Guest".',
      },
      kitchenTicketPrint: {
        label: 'Print a kitchen ticket when sending to the kitchen',
        type: 'boolean',
        default: false,
        help: 'For kitchens that work from paper as well as the screen.',
      },
    },
  },

  /*
   * The kitchen — the Kitchen Display and the counter Order Board.
   */
  kitchen: {
    label: 'Kitchen Display',
    description: 'How tickets reach the kitchen and how long before they turn amber and red.',
    group: 'operations',
    fields: {
      kitchenEnabled: {
        label: 'Use the Kitchen Display',
        type: 'boolean',
        default: true,
        help: 'Off: till sales complete immediately and nothing is sent to the kitchen.',
      },
      kitchenOpenAccess: {
        label: 'Open the kitchen screens without signing in',
        type: 'boolean',
        default: true,
        help:
          'On: /kitchen and /display show the orders straight away, with no login. ' +
          'Turn OFF before the website is live on the internet — then a kitchen account must sign in.',
      },
      kitchenAutoFireOnPay: {
        label: 'Send paid till orders to the kitchen automatically',
        type: 'boolean',
        default: true,
        help: 'Off: only "Send to Kitchen" puts a till order on the kitchen screen.',
      },
      kitchenWebsiteOrders: {
        label: 'Website orders',
        type: 'select',
        options: [
          { value: 'review', label: 'Wait on the dashboard — staff forward them to the stations' },
          { value: 'auto', label: 'Send straight to the stations (by category)' },
          { value: 'off', label: 'Never send to the kitchen screens' },
        ],
        default: 'review',
        help:
          'With "wait on the dashboard", every new website order appears under Incoming orders on the ' +
          'dashboard, and a person chooses which station prepares each item.',
      },
      kitchenSoundAlerts: { label: 'Chime on new tickets', type: 'boolean', default: true },
      kitchenWarnMinutes: {
        label: 'Turn amber after (minutes)',
        type: 'number',
        default: 10,
        min: 1,
        max: 240,
      },
      kitchenLateMinutes: {
        label: 'Turn red after (minutes)',
        type: 'number',
        default: 20,
        min: 1,
        max: 480,
      },
      kitchenAutoCompleteHours: {
        label: 'Close forgotten paid tickets after (hours)',
        type: 'number',
        default: 12,
        min: 1,
        max: 72,
        help: 'A paid till ticket nobody marked served is closed automatically after this long.',
      },
    },
  },

  /*
   * The order board screen (/display) — the TV above the counter. Its own tab,
   * because owners look for "the display" by name, not inside the kitchen rules.
   */
  display: {
    label: 'Order Board Screen',
    description: 'The counter TV at /display: its title, message, and the videos beside the order numbers.',
    group: 'operations',
    fields: {
      displayTitle: {
        label: 'Title at the top',
        type: 'string',
        default: 'Order Status',
        maxLength: 60,
      },
      displayMessage: {
        label: 'Scrolling message at the bottom',
        type: 'string',
        default: 'Please collect your order when your number appears under Ready.',
        maxLength: 160,
      },
      displayReadyMinutes: {
        label: 'Keep ready orders on the board for (minutes)',
        type: 'number',
        default: 15,
        min: 1,
        max: 240,
      },
      displayVideos: {
        label: 'Videos',
        type: 'list',
        maxItems: 5,
        default: [],
        help:
          'Shown beside the order numbers on the counter screen, played one after another on a loop. ' +
          'MP4 works on every screen. Up to five, played one after another.',
        itemFields: {
          video: { label: 'Video', type: 'video', required: true },
          title: { label: 'Name (for you)', type: 'string', maxLength: 60 },
        },
      },
      displayVideoShare: {
        label: 'Video size on the screen',
        type: 'select',
        options: [
          { value: '85', label: '85% video — order numbers in a slim strip' },
          { value: '80', label: '80% video (recommended)' },
          { value: '75', label: '75% video' },
          { value: '70', label: '70% video' },
          { value: '60', label: '60% video' },
          { value: '50', label: 'Half and half' },
        ],
        default: '80',
        help:
          'How much of the screen the video takes; Preparing and Ready share the rest. On a wide screen ' +
          'the orders sit beside the video, on a tall (portrait) screen or phone they sit under it. ' +
          'Small screens always keep enough room to read the numbers.',
      },
      displayVideoSide: {
        label: 'Video side',
        type: 'select',
        options: [
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
        ],
        default: 'right',
        help: 'On a wide screen. On a tall screen the video is always on top.',
      },
      displayVideoFit: {
        label: 'Video fit',
        type: 'select',
        options: [
          { value: 'cover', label: 'Fill the space (edges may be trimmed)' },
          { value: 'contain', label: 'Show the whole video' },
        ],
        default: 'cover',
      },
      displayVideoSound: {
        label: 'Play the video sound',
        type: 'boolean',
        default: false,
        help: 'Browsers only allow sound after someone taps the screen once.',
      },
      displayUseStoryVideo: {
        label: 'No videos added? Play the homepage story video',
        type: 'boolean',
        default: true,
        help: 'Uses the story video from Website Management → Website Content until you add videos here.',
      },
    },
  },

  delivery: {
    label: 'Delivery',
    description: 'Charges applied to online orders.',
    group: 'operations',
    fields: {
      deliveryFee: { label: 'Delivery Fee', unit: 'currency', type: 'number', default: 60, min: 0 },
      freeDeliveryThreshold: {
        label: 'Free Delivery Above',
        unit: 'currency',
        type: 'number',
        default: 3000,
        min: 0,
        help: 'Orders at or above this value ship free. Set 0 to disable.',
      },
      minimumOrderValue: { label: 'Minimum Order', unit: 'currency', type: 'number', default: 0, min: 0 },
    },
  },

  orders: {
    label: 'Orders & Payments',
    description: 'How payments on website orders are recorded.',
    group: 'operations',
    fields: {
      codPaidOnDelivery: {
        label: 'Mark cash-on-delivery orders paid when delivered',
        type: 'boolean',
        default: true,
        help: 'Off: record each COD payment by hand from the Orders screen.',
      },
    },
  },
});

/** Flat map of every key to its default — the fallback layer. */
/** Which section each key belongs to — see `get`. */
const FIELD_OWNER = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA).flatMap(([sectionKey, section]) =>
      Object.keys(section.fields).map((key) => [key, sectionKey]),
    ),
  ),
);

const DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.values(SETTINGS_SCHEMA).flatMap((section) =>
      Object.entries(section.fields).map(([key, field]) => [key, field.default]),
    ),
  ),
);

const settingSchema = new mongoose.Schema(
  {
    // One document per section rather than per key: a settings form saves a
    // whole section at once, so this makes the write atomic.
    section: { type: String, required: true, unique: true, index: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Setting = mongoose.model('Setting', settingSchema);

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * May this string be used as a link on the public site?
 *
 * An allow-list of schemes, not a block-list: `javascript:` is the obvious
 * danger, but `data:` and `vbscript:` do the same damage, and a block-list is
 * always one scheme behind. A relative path (`/p/privacy`) is allowed; a
 * protocol-relative one (`//evil.example`) is not, because it leaves the site.
 */
export function isSafeLink(value) {
  const text = String(value ?? '').trim();
  if (text === '') return true;
  if (text.startsWith('/') && !text.startsWith('//')) return true;
  if (/^(mailto|tel):/i.test(text)) return true;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Fail with a 422 naming the field, so the form can highlight it. */
function invalid(field, message) {
  return ApiError.validation([{ field, message }], message);
}

/**
 * Coerce and check one value against its field description.
 * @param {string} path  for error messages, e.g. "socialLinks.2.url"
 */
function cleanValue(field, raw, path) {
  const label = field.label ?? path;

  switch (field.type) {
    case 'number': {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw invalid(path, `${label} must be a number`);
      if (field.min !== undefined && value < field.min)
        throw invalid(path, `${label} cannot be below ${field.min}`);
      if (field.max !== undefined && value > field.max) {
        // For a percent field this is the guard that catches "17" meaning 17%
        // arriving unscaled — 17 is far outside the 0–1 fraction range.
        throw invalid(path, `${label} cannot be above ${field.max}`);
      }
      return value;
    }

    case 'boolean':
      // Strings from a form ("false") must not become true.
      if (typeof raw === 'string') return raw === 'true';
      return Boolean(raw);

    case 'select': {
      const value = String(raw ?? '');
      if (!field.options.some((option) => option.value === value)) {
        throw invalid(path, `${label} must be one of: ${field.options.map((o) => o.label).join(', ')}`);
      }
      return value;
    }

    case 'color': {
      const value = String(raw ?? '').trim();
      if (!HEX_COLOR.test(value)) throw invalid(path, `${label} must be a colour like #f9b416`);
      return value.toLowerCase();
    }

    case 'url': {
      const value = String(raw ?? '').trim();
      if (!isSafeLink(value)) {
        throw invalid(path, `${label} must be a web address (https://…), mailto:, tel: or a /path`);
      }
      return value;
    }

    case 'schedule': {
      try {
        return cleanSchedule(raw);
      } catch (error) {
        throw invalid(path, error.message);
      }
    }

    case 'list': {
      if (!Array.isArray(raw)) throw invalid(path, `${label} must be a list`);
      if (field.maxItems && raw.length > field.maxItems) {
        throw invalid(path, `${label} can have at most ${field.maxItems} entries`);
      }

      return raw.map((item, index) => {
        if (!item || typeof item !== 'object') throw invalid(`${path}.${index}`, `${label} entry is invalid`);
        const clean = {};
        for (const [key, itemField] of Object.entries(field.itemFields)) {
          const itemPath = `${path}.${index}.${key}`;
          const present = item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== '';
          if (!present) {
            if (itemField.required)
              throw invalid(itemPath, `${itemField.label} is required (${label} #${index + 1})`);
            clean[key] = itemField.default ?? (itemField.type === 'boolean' ? false : '');
            continue;
          }
          clean[key] = cleanValue(itemField, item[key], itemPath);
        }
        return clean;
      });
    }

    // string, text, image, video
    default: {
      const value = String(raw ?? '').trim();
      if (field.maxLength && value.length > field.maxLength) {
        throw invalid(path, `${label} is too long (${field.maxLength} characters at most)`);
      }
      if ((field.type === 'image' || field.type === 'video') && value && !isSafeLink(value)) {
        throw invalid(path, `${label} must be an uploaded file or a web address`);
      }
      return value;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* The store                                                                 */
/* ------------------------------------------------------------------------ */

/** In-memory cache: section → overrides. */
let cache = new Map();
let warmed = false;

/** Listeners told after every successful update — see settings.routes (real-time). */
const listeners = new Set();

export const settingsService = {
  /** Load every override into the cache. Called once at boot. */
  async warm() {
    const documents = await Setting.find().lean();
    cache = new Map(documents.map((doc) => [doc.section, doc.values ?? {}]));
    warmed = true;
    logger.info(`Settings warmed (${documents.length} section override(s))`);
  },

  /**
   * Effective value for a key — override if present, otherwise the default.
   * Synchronous by design; see the note at the top of this file.
   */
  get(key) {
    /*
     * The section that owns the key first. A field moved to another section
     * (the Order Board fields left "kitchen" for "display") may still have an
     * older value saved under its old section; that is used only until the
     * new section saves one, so moving a field never loses or shadows a value.
     */
    const own = cache.get(FIELD_OWNER[key]);
    if (own && own[key] !== undefined && own[key] !== null) return own[key];
    for (const values of cache.values()) {
      if (values && key in values && values[key] !== undefined && values[key] !== null) {
        return values[key];
      }
    }
    return DEFAULTS[key];
  },

  /** Every effective value, for the admin form and the POS config endpoint. */
  all() {
    return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, this.get(key)]));
  },

  /** Section definitions plus current values — drives the settings screens. */
  describe({ group } = {}) {
    const effective = this.all();
    return Object.entries(SETTINGS_SCHEMA)
      .filter(([, section]) => !group || section.group === group)
      .map(([key, section]) => ({
        key,
        label: section.label,
        description: section.description,
        group: section.group,
        fields: Object.entries(section.fields).map(([fieldKey, field]) => ({
          key: fieldKey,
          ...field,
          value: effective[fieldKey],
        })),
      }));
  },

  /**
   * Update a section.
   * Validates against the registry, so an out-of-range tax rate — or a
   * `javascript:` link in the footer — cannot be written even by a direct API call.
   */
  async update(sectionKey, patch, actorId) {
    const section = SETTINGS_SCHEMA[sectionKey];
    if (!section) throw ApiError.notFound(`Settings section "${sectionKey}"`);

    const clean = {};
    for (const [key, raw] of Object.entries(patch ?? {})) {
      const field = section.fields[key];
      if (!field) continue; // Silently drop unknown keys rather than storing junk.
      clean[key] = cleanValue(field, raw, key);
    }

    if (Object.keys(clean).length === 0) {
      throw ApiError.badRequest(`Nothing to save in ${section.label}.`);
    }

    // Kitchen timers must escalate in order: amber before red.
    if (sectionKey === 'kitchen') {
      const warn = clean.kitchenWarnMinutes ?? this.get('kitchenWarnMinutes');
      const late = clean.kitchenLateMinutes ?? this.get('kitchenLateMinutes');
      if (late <= warn) throw invalid('kitchenLateMinutes', 'The red time must be later than the amber time');
    }

    const merged = { ...(cache.get(sectionKey) ?? {}), ...clean };
    await Setting.findOneAndUpdate(
      { section: sectionKey },
      { $set: { values: merged, updatedBy: actorId } },
      { upsert: true, new: true },
    );

    cache.set(sectionKey, merged);
    logger.info('Settings updated', { section: sectionKey, keys: Object.keys(clean), by: actorId });

    for (const listener of listeners) {
      try {
        listener(sectionKey, Object.keys(clean));
      } catch {
        /* A listener failing must not fail the save. */
      }
    }

    return this.describe();
  },

  /** Be told whenever a section is saved. Returns an unsubscribe function. */
  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  get isWarmed() {
    return warmed;
  },
};

/* ------------------------------------------------------------------------ */
/* Views — the shapes each consumer reads                                   */
/* ------------------------------------------------------------------------ */

/**
 * Pricing rules resolved from settings.
 * Cart, checkout and the POS all call this — never a hard-coded constant — so
 * a change to the GST rate takes effect everywhere at once with no restart.
 */
export function pricingRules() {
  return {
    taxRate: settingsService.get('taxRate'),
    taxInclusive: settingsService.get('taxInclusive'),
    taxLabel: settingsService.get('taxLabel'),
    deliveryFee: settingsService.get('deliveryFee'),
    freeDeliveryThreshold: settingsService.get('freeDeliveryThreshold'),
    minimumOrderValue: settingsService.get('minimumOrderValue'),
  };
}

/**
 * Business identity for receipts and the storefront footer.
 * Blank fields are omitted by the consumer rather than printed as empty lines.
 */
export function businessDetails() {
  const all = settingsService.all();
  return {
    name: all.businessName,
    tagline: all.businessTagline,
    logoUrl: all.logoUrl || null,
    address: all.businessAddress,
    phone: all.businessPhone,
    email: all.businessEmail,
    taxNumber: all.taxNumber,
    receiptFooter: all.receiptFooter,
    hours: all.businessHours,
    // Only the links that are actually set. A footer icon linking nowhere is
    // worse than a footer with fewer icons.
    social: Object.fromEntries(
      Object.entries({
        facebook: all.socialFacebook,
        instagram: all.socialInstagram,
        tiktok: all.socialTiktok,
        whatsapp: all.socialWhatsapp,
      }).filter(([, value]) => Boolean(value)),
    ),
  };
}

export function counterPayments() {
  return {
    jazzcashTillId: settingsService.get('jazzcashTillId'),
    jazzcashQrImage: settingsService.get('jazzcashQrImage'),
    jazzcashMerchantName: settingsService.get('jazzcashMerchantName'),
    jazzcashUssd: settingsService.get('jazzcashUssd'),
  };
}

/**
 * Owner-editable storefront content.
 * The homepage reads this instead of hard-coded copy, so the hero banner, the
 * story video and the headline text can all be changed from Settings without a
 * deploy.
 */
export function siteContent() {
  const all = settingsService.all();
  return {
    heroKicker: all.heroKicker,
    heroTitle: all.heroTitle,
    heroBody: all.heroBody,
    heroImage: all.heroImage,
    storyVideoUrl: all.storyVideoUrl,
    storyPosterUrl: all.storyPosterUrl,
    storyHeading: all.storyHeading,
    storyBody: all.storyBody,
    whyHeading: all.whyHeading,
    whyChooseUs: all.whyChooseUs ?? [],

    // About page. Sent as a list rather than eight loose keys so the page can
    // simply filter out the blanks — an owner who has three real figures should
    // not get a fourth empty card.
    aboutHeading: all.aboutHeading,
    aboutLead: all.aboutLead,
    aboutBody: all.aboutBody,
    aboutImage: all.aboutImage || null,
    aboutImage2: all.aboutImage2 || null,
    aboutSince: all.aboutSince,
    aboutQuote: all.aboutQuote,
    aboutQuoteBy: all.aboutQuoteBy,
    aboutSections: all.aboutSections ?? [],
    aboutStats: [1, 2, 3, 4]
      .map((n) => ({ value: all[`aboutStat${n}Value`], label: all[`aboutStat${n}Label`] }))
      .filter((stat) => stat.value),
    aboutStepsHeading: all.aboutStepsHeading,
    aboutSteps: all.aboutSteps ?? [],
    aboutTimelineHeading: all.aboutTimelineHeading,
    aboutTimeline: all.aboutTimeline ?? [],
    aboutTeamHeading: all.aboutTeamHeading,
    aboutTeam: all.aboutTeam ?? [],
    aboutGalleryHeading: all.aboutGalleryHeading,
    aboutGallery: (all.aboutGallery ?? []).filter((item) => item.image),
    aboutShowVisit: Boolean(all.aboutShowVisit),
  };
}

/**
 * Where the shop stands right now, for ordering. `now` is injectable for tests.
 * `enforced` false means the website takes orders whatever the time.
 */
export function orderingStatus({ now = new Date() } = {}) {
  const all = settingsService.all();
  const status = hoursStatus(all.openingHours, {
    now,
    lastOrderMinutes: Number(all.hoursLastOrderMinutes) || 0,
    temporarilyClosed: Boolean(all.hoursTemporarilyClosed),
  });
  const enforced = Boolean(all.hoursEnforceOnline);
  return {
    ...status,
    enforced,
    // What the website acts on: closed shops still take orders when not enforced.
    canOrder: enforced ? status.acceptingOrders : !all.hoursTemporarilyClosed,
    title: all.hoursClosedTitle,
    message: all.hoursClosedMessage,
    summary: scheduleSummary(all.openingHours),
  };
}

/** The homepage carousel. */
export function sliderSettings() {
  const all = settingsService.all();
  return {
    slides: (all.sliderSlides ?? []).filter((slide) => slide.image),
    effect: all.sliderEffect,
    interval: all.sliderInterval,
    autoplay: Boolean(all.sliderAutoplay),
    height: all.sliderHeight,
    calmForReducedMotion: Boolean(all.sliderCalmForReducedMotion),
  };
}

/** Theme for every surface. */
export function themeSettings() {
  const all = settingsService.all();
  return {
    brandColor: all.brandColor,
    modes: {
      website: all.websiteMode,
      admin: all.adminMode,
      pos: all.posMode,
      kitchen: all.kitchenMode,
    },
  };
}

/**
 * Footer: blurb, copyright, every social link (the four legacy fields merged
 * with the owner's list, legacy first, duplicates dropped), extra links and the
 * custom fields marked for the footer.
 */
export function footerSettings() {
  const all = settingsService.all();
  const legacy = [
    ['facebook', all.socialFacebook],
    ['instagram', all.socialInstagram],
    ['tiktok', all.socialTiktok],
    // A bare number becomes a wa.me link, which is what a customer's tap needs.
    ['whatsapp', all.socialWhatsapp ? `https://wa.me/${String(all.socialWhatsapp).replace(/\D/g, '')}` : ''],
  ]
    .filter(([, url]) => Boolean(url))
    .map(([platform, url]) => ({ platform, url, label: '' }));

  const seen = new Set();
  const socialLinks = [...legacy, ...(all.socialLinks ?? [])].filter((link) => {
    const key = link.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    about: all.footerAbout,
    copyright: all.copyrightText,
    socialLinks,
    links: all.footerLinks ?? [],
    customFields: (all.customFields ?? []).filter((field) => field.showInFooter),
  };
}

/** Everything the Contact page needs beyond the business details. */
export function contactSettings() {
  const all = settingsService.all();
  return {
    image: all.contactImage || null,
    bannerShade: all.contactBannerShade,
    bannerLabel: all.contactBannerLabel,
    heading: all.contactHeading,
    intro: all.contactIntro,
    showForm: Boolean(all.contactShowForm),
    showMap: Boolean(all.contactShowMap),
    mapQuery: all.contactMapQuery || all.businessAddress || '',
    customFields: (all.customFields ?? []).filter((field) => field.showOnContact),
  };
}

/** The till's behaviour and slip layout. */
export function posSettings() {
  const all = settingsService.all();
  const quickCash = String(all.posQuickCash ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 8);

  return {
    defaultOrderType: all.posDefaultOrderType,
    askTable: Boolean(all.posAskTable),
    quickCash: quickCash.length ? quickCash : [500, 1000, 2000, 5000],
    receipt: {
      paperWidth: all.receiptPaperWidth,
      fontSize: all.receiptFontSize,
      bold: Boolean(all.receiptBold),
      showLogo: Boolean(all.receiptShowLogo),
      showBarcode: Boolean(all.receiptShowBarcode),
      headerNote: all.receiptHeaderNote,
    },
    kitchenTicketPrint: Boolean(all.kitchenTicketPrint),
  };
}

/** Kitchen Display and Order Board configuration. */
export function kitchenSettings() {
  const all = settingsService.all();
  return {
    enabled: Boolean(all.kitchenEnabled),
    openAccess: Boolean(all.kitchenOpenAccess),
    autoFireOnPay: Boolean(all.kitchenAutoFireOnPay),
    websiteOrders: all.kitchenWebsiteOrders,
    soundAlerts: Boolean(all.kitchenSoundAlerts),
    warnMinutes: all.kitchenWarnMinutes,
    lateMinutes: all.kitchenLateMinutes,
    autoCompleteHours: all.kitchenAutoCompleteHours,
    display: {
      title: all.displayTitle,
      message: all.displayMessage,
      readyMinutes: all.displayReadyMinutes,
      videos: (() => {
        const own = (all.displayVideos ?? []).filter((item) => item.video);
        if (own.length || !all.displayUseStoryVideo || !all.storyVideoUrl) return own;
        return [{ video: all.storyVideoUrl, title: 'Homepage story video' }];
      })(),
      videoSide: all.displayVideoSide,
      // Percent of the board the video takes (50–85); the orders share the rest.
      videoShare: Math.min(85, Math.max(50, Number(all.displayVideoShare) || 80)),
      videoFit: all.displayVideoFit,
      videoSound: Boolean(all.displayVideoSound),
    },
  };
}

export default settingsService;
