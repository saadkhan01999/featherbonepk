import { useCallback, useEffect, useRef } from 'react';

/**
 * Make an overlay behave like a real dialog: trap Tab, close on Escape, lock
 * page scroll, and give focus back where it came from.
 * ---------------------------------------------------------------------------
 * Why it is a hook and not a second copy:
 *
 * `Modal` already did all of this correctly. `CartDrawer` announced itself as
 * `role="dialog" aria-modal="true"` and did none of it — Tab walked straight
 * out into the page behind, which for a keyboard or screen-reader user means
 * the drawer is a trap in the other direction: they are told a dialog is open
 * while focus is somewhere they cannot see.
 *
 * Copying the thirty lines across would have left two implementations to drift.
 * Both now call this.
 *
 * @param {boolean} isOpen
 * @param {object} options
 * @param {() => void} options.onClose
 * @param {boolean} [options.closeOnEscape]
 * @param {boolean} [options.lockScroll]
 * @returns {{ containerRef: import('react').RefObject<HTMLElement> }}
 */

/** Elements that can hold keyboard focus. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(isOpen, { onClose, closeOnEscape = true, lockScroll = true } = {}) {
  const containerRef = useRef(null);
  const previouslyFocused = useRef(null);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab' || !containerRef.current) return;

      const focusable = Array.from(containerRef.current.querySelectorAll(FOCUSABLE)).filter(
        // offsetParent is null for display:none elements — a hidden control
        // must not become a dead stop in the tab cycle.
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap at both ends so focus can never leave.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeOnEscape, onClose],
  );

  /*
   * The handler lives in a ref and the effect depends on `isOpen` alone.
   *
   * Listing the handler as a dependency re-subscribes on every render, which
   * remounts the subtree and drops focus after each keystroke — the bug where
   * typing into a dialog meant clicking the field again for every letter.
   */
  const keyDownRef = useRef(handleKeyDown);
  keyDownRef.current = handleKeyDown;

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocused.current = document.activeElement;

    let restoreScroll;
    if (lockScroll) {
      // Removing the scrollbar reflows the page narrower, so replace its width
      // with padding to keep the layout still.
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const { overflow, paddingRight } = document.body.style;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
      restoreScroll = () => {
        document.body.style.overflow = overflow;
        document.body.style.paddingRight = paddingRight;
      };
    }

    const onKeyDown = (event) => keyDownRef.current(event);
    document.addEventListener('keydown', onKeyDown);

    // Next frame: before paint the panel has no laid-out children to focus.
    const raf = requestAnimationFrame(() => {
      const target = containerRef.current?.querySelector(FOCUSABLE);
      (target ?? containerRef.current)?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      restoreScroll?.();
      // Return focus to whatever opened this, so the keyboard user resumes
      // where they were rather than at the top of the document.
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, lockScroll]);

  return { containerRef };
}

export default useFocusTrap;
