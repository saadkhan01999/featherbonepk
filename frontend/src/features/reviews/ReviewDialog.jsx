import { useEffect, useState } from 'react';
import { Star, AlertCircle, CheckCircle2 } from 'lucide-react';

import { Modal } from '@/components/ui/Modal.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { Textarea } from '@/components/ui/Input.jsx';
import { apiClient } from '@/services/apiClient.js';
import { cn } from '@/lib/utils.js';

/**
 * Leave a review for one item from one order.
 * ---------------------------------------------------------------------------
 * The order number travels with the review because the server verifies the
 * purchase against it. The customer never types it — it comes from the order
 * they are already looking at.
 */

const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export function ReviewDialog({ isOpen, onClose, item, orderNumber, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Reset on open, so reviewing a second dish doesn't inherit the first one's
  // stars — a stale 5 that the customer never chose is worse than no review.
  useEffect(() => {
    if (isOpen) {
      setRating(0);
      setHovered(0);
      setComment('');
      setError(null);
      setDone(false);
    }
  }, [isOpen]);

  async function submit(event) {
    event.preventDefault();
    if (!rating) {
      setError('Please choose a rating first.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/reviews', {
        productId: item.product,
        orderNumber,
        rating,
        ...(comment.trim() && { comment: comment.trim() }),
      });
      setDone(true);
      onSubmitted?.(item.product);
    } catch (err) {
      setError(err.message ?? 'Could not send your review. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // The star being previewed on hover/focus, falling back to the chosen one.
  const shown = hovered || rating;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={done ? 'Thank you!' : `How was the ${item?.name}?`}
      description={done ? undefined : 'Your feedback helps us and helps other diners.'}
      size="sm"
    >
      {done ? (
        <div className="py-2 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">
            Your review has been sent. It will appear on the menu once our team has checked it.
          </p>
          <Button className="mt-5 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {/* --- Stars --- */}
          <div>
            <div
              className="flex items-center justify-center gap-1"
              onMouseLeave={() => setHovered(0)}
              role="radiogroup"
              aria-label="Rating"
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={rating === star}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHovered(star)}
                  // Keyboard users get the same preview as mouse users.
                  onFocus={() => setHovered(star)}
                  onBlur={() => setHovered(0)}
                  className="rounded p-1 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-colors',
                      star <= shown ? 'fill-gold text-gold' : 'text-border-strong',
                    )}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>

            {/* Reserve the line's height so choosing a star doesn't shift the
                dialog and move the button out from under the cursor. */}
            <p className="mt-1 h-5 text-center text-sm font-medium text-gold">{RATING_WORDS[shown] ?? ''}</p>
          </div>

          <Textarea
            label="Anything you'd like to add?"
            placeholder="Tell us about the taste, portion or packaging…"
            rows={4}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            hint="Optional"
          />

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isSaving}>
              Not now
            </Button>
            <Button type="submit" className="flex-1" isLoading={isSaving} loadingText="Sending…">
              Submit Review
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default ReviewDialog;
