import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils.js';

/**
 * RichText — renders the owner's page text safely.
 * ---------------------------------------------------------------------------
 * The owner writes pages (Privacy, Catering, FAQ…) in a small, forgiving
 * Markdown-like format:
 *
 *   # Heading   ## Smaller   ### Smaller still
 *   **bold**   *italic*   [link text](https://… or /menu)
 *   - bullet             1. numbered
 *   > quote              ---  (a divider)
 *
 * No HTML is ever injected. The text is parsed into React elements, so there is
 * no `dangerouslySetInnerHTML` and nothing in a page — pasted from a website, a
 * Word file or typed by someone malicious — can run a script on the storefront.
 * Links are allowed only to http(s), mailto:, tel:, on-site paths and anchors;
 * a `javascript:` link is shown as plain text.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const INLINE = /(\*\*([^*]+?)\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*\s][^*]*?)\*)|(_([^_\s][^_]*?)_)/g;

/** Bold, italic and links inside one line of text. */
function renderInline(text, key) {
  const out = [];
  let last = 0;
  let match;
  let i = 0;
  // A fresh expression per call: bold text is rendered recursively, and a
  // shared global regex would have its position reset by the inner call.
  const pattern = new RegExp(INLINE.source, 'g');

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const k = `${key}-${i++}`;

    if (match[1]) {
      out.push(<strong key={k}>{renderInline(match[2], k)}</strong>);
    } else if (match[3]) {
      const [label, href] = [match[4], match[5]];
      if (!SAFE_HREF.test(href)) {
        out.push(label);
      } else if (href.startsWith('/') || href.startsWith('#')) {
        out.push(
          <Link key={k} to={href} className="font-medium text-gold underline-offset-4 hover:underline">
            {label}
          </Link>,
        );
      } else {
        out.push(
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gold underline-offset-4 hover:underline"
          >
            {label}
          </a>,
        );
      }
    } else {
      out.push(<em key={k}>{match[7] ?? match[9]}</em>);
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lines → blocks. */
export function parseBlocks(source = '') {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let quote = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', lines: paragraph });
    if (list) blocks.push(list);
    if (quote.length) blocks.push({ type: 'quote', lines: quote });
    paragraph = [];
    list = null;
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ type: `h${heading[1].length}`, text: heading[2] });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: 'hr' });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.type !== kind) {
        flush();
        list = { type: kind, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(trimmed);
    if (quoted) {
      if (paragraph.length || list) flush();
      quote.push(quoted[1]);
      continue;
    }

    if (list || quote.length) flush();
    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}

export function RichText({ source, className }) {
  const blocks = parseBlocks(source);
  if (!blocks.length) return null;

  return (
    <div className={cn('space-y-4 leading-relaxed text-foreground/90', className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case 'h1':
            return (
              <h2 key={key} className="pt-2 text-2xl font-bold tracking-tight text-foreground">
                {renderInline(block.text, key)}
              </h2>
            );
          case 'h2':
            return (
              <h3 key={key} className="pt-1 text-xl font-semibold text-foreground">
                {renderInline(block.text, key)}
              </h3>
            );
          case 'h3':
            return (
              <h4 key={key} className="text-lg font-semibold text-foreground">
                {renderInline(block.text, key)}
              </h4>
            );
          case 'hr':
            return <hr key={key} className="border-border" />;
          case 'ul':
          case 'ol': {
            const List = block.type;
            return (
              <List
                key={key}
                className={cn('space-y-1.5 pl-6', block.type === 'ul' ? 'list-disc' : 'list-decimal')}
              >
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`} className="marker:text-gold">
                    {renderInline(item, `${key}-${i}`)}
                  </li>
                ))}
              </List>
            );
          }
          case 'quote':
            return (
              <blockquote key={key} className="border-l-4 border-gold/60 pl-4 italic text-muted-foreground">
                {block.lines.map((line, i) => (
                  <Fragment key={`${key}-${i}`}>
                    {i > 0 && <br />}
                    {renderInline(line, `${key}-${i}`)}
                  </Fragment>
                ))}
              </blockquote>
            );
          default:
            return (
              <p key={key}>
                {block.lines.map((line, i) => (
                  <Fragment key={`${key}-${i}`}>
                    {i > 0 && <br />}
                    {renderInline(line, `${key}-${i}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

export default RichText;
