import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { backdrop, modalContent, prefersReducedMotion } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Modal — centred, animated dialog.
 * ---------------------------------------------------------------------------
 * Every dialog in the suite (add product, payment, refund, confirm delete) is
 * built on this, so behaviour is identical everywhere.
 *
 * What a correct dialog has to do — each of these is a real bug if skipped:
 *
 *  1. Portal to <body>. Rendered in place, an ancestor's `overflow:hidden` or
 *     `transform` clips or re-anchors a fixed-position dialog. The POS screen
 *     is `overflow-hidden`, so this is not hypothetical here.
 *  2. Trap focus. Tab must cycle inside the dialog; otherwise keyboard focus
 *     wanders onto the page behind, which a screen-reader user cannot see.
 *  3. Restore focus on close, back to the element that opened it.
 *  4. Lock body scroll, compensating for the scrollbar width so the page
 *     underneath doesn't visibly shift sideways as it opens.
 *  5. Close on escape — the universally expected gesture.
 *  6. Label the dialog via aria-labelledby so it is announced by name.
 *
 * Animation note: the conditional render lives inside <AnimatePresence>. That
 * ordering is what lets the exit animation play and unmount. Gating the whole
 * AnimatePresence on `isOpen` skips the exit; conditionally rendering outside it
 * can leave a fully-transparent backdrop mounted over the page, silently eating
 * every click on the screen behind.
 */

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw]',
};

/** Elements that can hold keyboard focus, for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduceMotion = prefersReducedMotion();

  /*
   * --- Escape + focus trap -------------------------------------------------
   *
   * Held in a ref, not a dependency.
   *
   * This was a `useCallback([closeOnEscape, onClose])`, and the open/close
   * effect below depended on it. Every caller passes `onClose={() => …}` —
   * a fresh function on every parent render — so a single keystroke in any
   * modal field produced a new callback, tore the effect down, and its cleanup
   * ran `previouslyFocused.focus()`. The effect then re-ran and focused the
   * first field again.
   *
   * The visible result: typing one letter threw the cursor to another field, in
   * every dialog in the application. Users had to click back into the input for
   * each character.
   *
   * A ref keeps the latest logic available to a listener that is attached once.
   */
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onClose?.();
        return;
      }

      // --- Focus trap ---
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(
        // offsetParent is null for display:none elements — a hidden control
        // must not become a dead stop in the tab cycle.
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap around at both ends so focus can never leave the dialog.
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

  // Always points at the current handler without being a dependency itself.
  const keyDownRef = useRef(handleKeyDown);
  keyDownRef.current = handleKeyDown;

  // --- Open/close side effects -------------------------------------------
  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocused.current = document.activeElement;

    // Lock scrolling. Removing the scrollbar reflows the page narrower, so we
    // replace its width with padding to keep the layout still.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingRight } = document.body.style;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    // A stable wrapper: the listener is added once per open, and always calls
    // the newest handler through the ref.
    const onKeyDown = (event) => keyDownRef.current(event);
    document.addEventListener('keydown', onKeyDown);

    // Move focus into the dialog on the next frame — before paint the panel
    // has no laid-out children to focus.
    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector(FOCUSABLE);
      (target ?? panelRef.current)?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      // Return focus so keyboard users resume where they left off.
      previouslyFocused.current?.focus?.();
    };
    // Only `isOpen`. Adding the handler here is what caused the focus to jump
    // on every keystroke — see the note above it.
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="presentation">
          {/* Backdrop — blurred so the dialog reads as the focal plane. */}
          <motion.div
            {...backdrop}
            transition={reduceMotion ? { duration: 0 } : backdrop.transition}
            onClick={closeOnBackdrop ? onClose : undefined}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            {...modalContent}
            transition={reduceMotion ? { duration: 0 } : modalContent.transition}
            className={cn(
              'relative z-10 flex w-full flex-col overflow-hidden',
              'rounded-2xl border border-border-strong bg-surface-raised shadow-overlay',
              // Never taller than the viewport; the body scrolls, so the header
              // and footer actions stay reachable on a short screen.
              'max-h-[90vh]',
              SIZES[size] ?? SIZES.md,
              className,
            )}
          >
            {(title || showCloseButton) && (
              <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  {title && (
                    <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>

                {showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="-mr-1 -mt-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

            {footer && (
              <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-surface/50 px-5 py-4">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * ConfirmDialog — destructive-action confirmation.
 * Exists as its own component because "are you sure?" is asked in a dozen
 * places, and every one of them should look and behave identically.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  isLoading = false,
  /**
   * Optional extra content below the message — a field the confirmation needs
   * (a guest proving an order is theirs), or an error from the last attempt.
   * Without this, the one place that needs an input would have to hand-build a
   * second, slightly different confirmation dialog.
   */
  children,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnBackdrop={!isLoading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
      {children}
    </Modal>
  );
}

export default Modal;
