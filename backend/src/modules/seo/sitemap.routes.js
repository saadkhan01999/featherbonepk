/**
 * sitemap.xml — generated from the live catalogue.
 * ---------------------------------------------------------------------------
 * Public and unauthenticated, by necessity: a crawler has no credentials.
 *
 * Why generated rather than a file. The menu changes whenever the owner adds a
 * dish or hides one for the season. A static sitemap starts wrong the first
 * time that happens, and a sitemap listing pages that 404 is worse than none —
 * it teaches the crawler the site is unreliable and it comes back less often.
 *
 * Only what is actually public. Inactive products, till-only items and anything
 * behind a login are excluded. A sitemap is a set of promises about pages a
 * stranger can open; listing a POS-only item breaks that promise and leaks the
 * shape of the internal catalogue at the same time.
 */
import { Router } from 'express';

import { env } from '../../config/env.config.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { Product } from '../catalog/product.model.js';
import { Category } from '../catalog/category.model.js';

const router = Router();

/** The static storefront routes, with a rough sense of how often each moves. */
const STATIC_PAGES = [
  { path: '', changefreq: 'daily', priority: '1.0' },
  { path: 'menu', changefreq: 'daily', priority: '0.9' },
  { path: 'offers', changefreq: 'daily', priority: '0.8' },
  { path: 'about', changefreq: 'monthly', priority: '0.5' },
  { path: 'contact', changefreq: 'monthly', priority: '0.5' },
  { path: 'track-order', changefreq: 'yearly', priority: '0.3' },
];

/** XML-escape. An unescaped `&` in a product name invalidates the whole file. */
const escapeXml = (value) =>
  String(value).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

const urlEntry = ({ loc, lastmod, changefreq, priority }) =>
  [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod.toISOString().split('T')[0]}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');

router.get(
  '/sitemap.xml',
  asyncHandler(async (req, res) => {
    /*
     * The site's own address, not the API's. They are usually different hosts,
     * and a sitemap that lists api.shop.pk/menu points every crawler at JSON.
     */
    const base = env.CLIENT_URL.replace(/\/$/, '');

    const [categories, products] = await Promise.all([
      Category.find({ isActive: true, channels: { $ne: ['pos'] } })
        .select('slug updatedAt')
        .lean(),
      Product.find({ isActive: true, channels: { $ne: ['pos'] } })
        .select('slug updatedAt')
        .sort({ updatedAt: -1 })
        // Google ignores anything past 50,000 URLs and this shop will never
        // approach that; the cap is here so one runaway import cannot produce
        // a multi-megabyte response on every crawl.
        .limit(5000)
        .lean(),
    ]);

    const entries = [
      ...STATIC_PAGES.map((page) => ({
        loc: page.path ? `${base}/${page.path}` : base,
        changefreq: page.changefreq,
        priority: page.priority,
      })),
      ...categories.map((category) => ({
        loc: `${base}/menu/${category.slug}`,
        lastmod: category.updatedAt,
        changefreq: 'weekly',
        priority: '0.7',
      })),
      ...products.map((product) => ({
        loc: `${base}/product/${product.slug}`,
        lastmod: product.updatedAt,
        changefreq: 'weekly',
        priority: '0.6',
      })),
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map(urlEntry),
      '</urlset>',
    ].join('\n');

    res.type('application/xml');
    // An hour: long enough that crawlers are not re-running two aggregations
    // every few minutes, short enough that a new dish is listed the same day.
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(xml);
  }),
);

export default router;
