import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * PrintPortal — renders children into a dedicated print-only root on <body>.
 * ---------------------------------------------------------------------------
 * Why this exists (a real bug this fixes):
 *
 * The POS receipt is previewed inside a modal. That modal is a scrollable box
 * (`max-h-[90vh]` + `overflow-y-auto`) animated by Framer Motion, which applies
 * a CSS `transform`. Both of those break the usual print trick of positioning
 * the receipt absolutely and hiding everything else:
 *
 *   • `overflow: auto` on an ancestor clips the printed output, so only the
 *     part that happened to be scrolled into view reaches the paper — the slip
 *     cut off mid-way through the header.
 *   • a `transform` on an ancestor makes it the containing block, so even
 *     `position: fixed` cannot escape it.
 *   • `visibility: hidden` on siblings still reserves their space, pushing the
 *     receipt down and printing blank leading pages.
 *
 * Fighting those with more print CSS is whack-a-mole. Rendering the receipt
 * into its own top-level node instead means it has no clipping, transformed or
 * scrolling ancestors at all, and print CSS simply hides everything else with
 * `display: none` (which reserves no space).
 *
 * The node is created once and reused; it is invisible on screen.
 */
export function PrintPortal({ children }) {
  const [node, setNode] = useState(null);

  useEffect(() => {
    let element = document.getElementById('fb-print-root');
    let created = false;

    if (!element) {
      element = document.createElement('div');
      element.id = 'fb-print-root';
      // Hidden on screen; the print stylesheet reveals it.
      element.setAttribute('aria-hidden', 'true');
      document.body.appendChild(element);
      created = true;
    }

    setNode(element);

    return () => {
      // Only remove what this component created, so two concurrent portals
      // don't tear each other's root out from underneath.
      if (created && element.childElementCount === 0) element.remove();
    };
  }, []);

  if (!node) return null;
  return createPortal(children, node);
}

/**
 * Print one thing, once, from anywhere — a kitchen ticket, a reprint.
 *
 *   const job = usePrintJob();
 *   job.print(<KitchenTicketSlip ticket={t} />);
 *   return <>{…}{job.portal}</>;
 *
 * The element is mounted into the print root, the browser gets two frames to
 * lay it out (printing on the same tick prints an empty page), the dialog
 * opens, and the element is removed again when printing ends — so the next
 * print cannot pick up a stale copy alongside the new one.
 */
export function usePrintJob() {
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (!job) return undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });
    const done = () => setJob(null);
    window.addEventListener('afterprint', done, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [job]);

  return {
    print: (node) => setJob({ node, at: Date.now() }),
    portal: job ? <PrintPortal key={job.at}>{job.node}</PrintPortal> : null,
  };
}

export default PrintPortal;
