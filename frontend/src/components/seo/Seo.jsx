import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { config } from '@/config/env.js';

/**
 * Per-page title, description, canonical, social cards and structured data.
 * ---------------------------------------------------------------------------
 * What was wrong. Every route served the one `<title>` baked into index.html,
 * so Google saw a site where the homepage, the menu, every category and every
 * single product were all called "Feather & Bone — Roast · Meat · Sweets ·
 * Bakery". Search engines collapse pages that look identical, and a shop whose
 * hundred product pages compete under one title ranks for none of them.
 *
 * No library. react-helmet-async is the usual answer and it is ~10KB to set
 * properties that already exist on `document`. This is an effect that writes
 * them and puts them back on unmount, which is the whole of what is needed for
 * a client-rendered app.
 *
 * The honest limitation, because it changes what you should expect: this is a
 * single-page app, so the tags are written by JavaScript after load. Google
 * renders JS and will see them. Facebook and WhatsApp link previews largely do
 * not — they read the raw HTML. So social cards fall back to the defaults in
 * index.html, which is why those defaults are written to be reasonable for any
 * page rather than left generic. Fixing that properly means server-rendering
 * or prerendering the storefront routes; it is a real piece of work, not a
 * setting, and pretending otherwise would be misleading.
 */

/** Write a <meta>, creating it if absent. Returns the previous value. */
function setMeta(selector, attribute, value) {
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    const [, key, name] = selector.match(/\[(\w+)="([^"]+)"\]/) ?? [];
    if (key && name) tag.setAttribute(key, name);
    document.head.appendChild(tag);
  }
  const previous = tag.getAttribute(attribute);
  if (value == null) tag.removeAttribute(attribute);
  else tag.setAttribute(attribute, value);
  return previous;
}

/**
 * @param {object} props
 * @param {string} props.title        Page title, without the brand suffix.
 * @param {string} [props.description]
 * @param {string} [props.image]      Absolute or site-relative preview image.
 * @param {boolean} [props.noindex]   Keep this page out of search results.
 * @param {object} [props.schema]     JSON-LD, already shaped.
 */
export function Seo({ title, description, image, noindex = false, schema }) {
  const { pathname } = useLocation();

  useEffect(() => {
    const brand = config.brand.name;
    // "Menu — Feather & Bone", but never "Feather & Bone — Feather & Bone".
    const fullTitle = title && title !== brand ? `${title} — ${brand}` : brand;
    const previousTitle = document.title;
    document.title = fullTitle;

    const canonical = `${window.location.origin}${pathname}`;

    const restore = [
      ['meta[name="description"]', 'content', setMeta('meta[name="description"]', 'content', description)],
      ['meta[property="og:title"]', 'content', setMeta('meta[property="og:title"]', 'content', fullTitle)],
      [
        'meta[property="og:description"]',
        'content',
        setMeta('meta[property="og:description"]', 'content', description),
      ],
      ['meta[property="og:url"]', 'content', setMeta('meta[property="og:url"]', 'content', canonical)],
      [
        'meta[name="robots"]',
        'content',
        setMeta('meta[name="robots"]', 'content', noindex ? 'noindex, nofollow' : 'index, follow'),
      ],
      [
        'meta[name="twitter:card"]',
        'content',
        setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image'),
      ],
      ['meta[name="twitter:title"]', 'content', setMeta('meta[name="twitter:title"]', 'content', fullTitle)],
    ];

    if (image) {
      const absolute = image.startsWith('http') ? image : `${window.location.origin}${image}`;
      restore.push(
        ['meta[property="og:image"]', 'content', setMeta('meta[property="og:image"]', 'content', absolute)],
        ['meta[name="twitter:image"]', 'content', setMeta('meta[name="twitter:image"]', 'content', absolute)],
      );
    }

    /*
     * Canonical. Without it, `/menu`, `/menu?sort=price` and `/menu?page=1`
     * look like three pages with the same content — which is how a shop ends up
     * competing against itself for its own listing.
     */
    let link = document.head.querySelector('link[rel="canonical"]');
    const createdCanonical = !link;
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    const previousCanonical = link.getAttribute('href');
    link.setAttribute('href', canonical);

    // JSON-LD in its own tag, removed on unmount so two pages' structured data
    // can never both be present.
    let ld;
    if (schema) {
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.textContent = JSON.stringify(schema);
      document.head.appendChild(ld);
    }

    return () => {
      document.title = previousTitle;
      for (const [selector, attribute, value] of restore) setMeta(selector, attribute, value);
      if (createdCanonical) link.remove();
      else link.setAttribute('href', previousCanonical ?? '');
      ld?.remove();
    };
  }, [title, description, image, noindex, schema, pathname]);

  return null;
}

export default Seo;
