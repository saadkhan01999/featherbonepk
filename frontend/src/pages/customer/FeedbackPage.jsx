import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  ChevronDown,
  HeartHandshake,
  MessageSquareHeart,
  Send,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, Textarea } from '@/components/ui/Input.jsx';
import { Switch } from '@/components/ui/Switch.jsx';
import { StarRating } from '@/components/common/StarRating.jsx';
import { FeedbackCard, ScoreSummary } from '@/components/customer/Testimonials.jsx';
import { Seo } from '@/components/seo/Seo.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useResource } from '@/features/catalog/catalog.api.js';
import { feedbackApi } from '@/features/feedback/feedback.api.js';
import { tagsForRating } from '@/features/feedback/feedbackTags.js';
import { useSiteStore } from '@/features/site/siteContext.jsx';
import { ROUTES } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';

/**
 * Customer feedback — /feedback
 * ---------------------------------------------------------------------------
 * Made to take ten seconds:
 *
 *   1. tap the stars              (the only thing required)
 *   2. tap what stood out         one-tap tags, chosen to suit the score
 *   3. anything else? your name?  both optional
 *   4. send
 *
 * Scores for food / service / delivery / value, an order number and a way to
 * reply are tucked under "Add more details". Links from the homepage and the
 * order page arrive with the stars already chosen (`?rating=5`) and the order
 * filled in (`?order=FB-…`). No account needed; the customer decides whether
 * it may appear on the website, and the owner reads everything in Back office
 * → Customer Feedback.
 */

const ASPECTS = [
  { key: 'food', label: 'Food' },
  { key: 'service', label: 'Service' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'value', label: 'Value for money' },
];

const PROMPT = {
  good: 'What did you love?',
  fix: 'What went wrong?',
  mixed: 'What stood out?',
};

function startingRating(params) {
  const n = Number(params.get('rating'));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0;
}

export function FeedbackPage() {
  const { user } = useAuth();
  const business = useSiteStore((s) => s.business);
  const [params] = useSearchParams();
  const { data: published } = useResource(() => feedbackApi.published(6), []);

  const [form, setForm] = useState(() => {
    const orderNumber = params.get('order') ?? '';
    return {
      rating: startingRating(params),
      tags: [],
      aspects: {},
      comment: '',
      name: user?.fullName ?? '',
      email: user?.email ?? '',
      phone: '',
      orderNumber,
      allowPublish: true,
      website: '',
    };
  });
  const [moreOpen, setMoreOpen] = useState(() => Boolean(params.get('order')));
  const [errors, setErrors] = useState({});
  const [sendError, setSendError] = useState(null);
  const [isSending, setSending] = useState(false);
  const [done, setDone] = useState(null);

  const offered = tagsForRating(form.rating);
  const tone = offered.good.length && offered.fix.length ? 'mixed' : offered.fix.length ? 'fix' : 'good';

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  function chooseRating(rating) {
    // Keep only the tags that still make sense for the new score.
    const allowed = new Set(
      [...tagsForRating(rating).good, ...tagsForRating(rating).fix].map(([key]) => key),
    );
    setForm((f) => ({ ...f, rating, tags: f.tags.filter((t) => allowed.has(t)) }));
    setErrors((e) => ({ ...e, rating: undefined }));
  }

  const toggleTag = (key) =>
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(key) ? f.tags.filter((t) => t !== key) : [...f.tags, key],
    }));

  function validate() {
    const next = {};
    if (!form.rating) next.rating = 'Tap a star — 1 to 5';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email';
    if (form.phone && !/^03\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) {
      next.phone = 'Enter a valid mobile number (03XXXXXXXXX)';
    }
    setErrors(next);
    if (next.email || next.phone) setMoreOpen(true);
    return Object.keys(next).length === 0;
  }

  async function submit(event) {
    event.preventDefault();
    if (!validate()) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await feedbackApi.submit({
        ...form,
        aspects: Object.fromEntries(Object.entries(form.aspects).filter(([, v]) => v)),
      });
      setDone({ ...result, rating: form.rating, name: form.name.trim().split(' ')[0] });
    } catch (err) {
      if (Array.isArray(err.details)) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        setSendError(err.message ?? 'Could not send your feedback. Please try again.');
      }
    } finally {
      setSending(false);
    }
  }

  const items = published?.items ?? [];

  return (
    <div>
      <Seo title="Feedback" description={`Tell ${business.name || 'us'} how we did.`} />

      <section className="border-b border-border bg-gradient-to-b from-surface to-background">
        <div className="container py-10 text-center sm:py-14">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold/15 text-gold">
            <MessageSquareHeart className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">How did we do?</h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
            It takes ten seconds — tap the stars, pick what stood out, send. The owner of{' '}
            {business.name || 'the restaurant'} reads every one.
          </p>
        </div>
      </section>

      <div className="container grid gap-10 py-10 sm:py-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------- The form, or the thank-you ---------------- */}
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-elevated sm:p-8">
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3 py-10 text-center"
                role="status"
              >
                <span className="relative grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
                  <HeartHandshake className="h-8 w-8" aria-hidden="true" />
                  <Sparkles className="absolute -right-1 -top-1 h-5 w-5 text-gold" aria-hidden="true" />
                </span>
                <h2 className="text-2xl font-bold">Thank you{done.name ? `, ${done.name}` : ''}!</h2>
                <p className="max-w-sm text-muted-foreground">
                  {done.rating >= 4
                    ? "We're so glad you enjoyed it. Your words mean a lot to the whole team."
                    : "We're sorry it wasn't perfect. The owner reads every message and will put it right."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reference <span className="font-mono text-foreground">{done.reference}</span>
                  {done.verifiedOrder && ' · linked to your order'}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button as={Link} to={ROUTES.MENU}>
                    Back to the menu
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDone(null);
                      setForm((f) => ({
                        ...f,
                        rating: 0,
                        tags: [],
                        aspects: {},
                        comment: '',
                        orderNumber: '',
                      }));
                    }}
                  >
                    Send another
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.form key="form" onSubmit={submit} noValidate exit={{ opacity: 0 }}>
                {sendError && (
                  <p
                    role="alert"
                    className="mb-5 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {sendError}
                  </p>
                )}

                {/* 1 — the stars */}
                <fieldset className="text-center">
                  <legend className="mx-auto text-lg font-semibold sm:text-xl">
                    How was your experience?
                  </legend>
                  <StarRating
                    value={form.rating}
                    onChange={chooseRating}
                    size="xl"
                    showWord
                    label="Your rating"
                    className="mt-4 flex-col justify-center gap-2 [&>div]:justify-center"
                  />
                  {errors.rating && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {errors.rating}
                    </p>
                  )}
                </fieldset>

                {/* 2–4 — appear once there is a score */}
                <AnimatePresence initial={false}>
                  {form.rating > 0 && (
                    <motion.div
                      key="rest"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-8 space-y-6 border-t border-border pt-6">
                        <fieldset>
                          <legend className="text-sm font-semibold">
                            {PROMPT[tone]}{' '}
                            <span className="font-normal text-muted-foreground">(tap any that apply)</span>
                          </legend>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {offered.good.map(([key, label]) => (
                              <TagChip
                                key={key}
                                label={label}
                                selected={form.tags.includes(key)}
                                onClick={() => toggleTag(key)}
                              />
                            ))}
                            {offered.fix.map(([key, label]) => (
                              <TagChip
                                key={key}
                                label={label}
                                fix
                                selected={form.tags.includes(key)}
                                onClick={() => toggleTag(key)}
                              />
                            ))}
                          </div>
                        </fieldset>

                        <Textarea
                          label="Anything else? (optional)"
                          rows={3}
                          value={form.comment}
                          maxLength={1000}
                          error={errors.comment}
                          hint={form.comment ? `${form.comment.length}/1000` : undefined}
                          placeholder={
                            form.rating >= 4
                              ? 'What did you order? What made it great?'
                              : 'What happened? We want to put it right.'
                          }
                          onChange={(e) => set('comment', e.target.value)}
                        />

                        <Input
                          label="Your name (optional)"
                          value={form.name}
                          error={errors.name}
                          placeholder="So we know who to thank"
                          onChange={(e) => set('name', e.target.value)}
                        />

                        <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-background/40 p-3.5">
                          <div className="min-w-0 text-sm">
                            <p className="font-medium">Show my feedback on the website</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Only your first name and initial — never your email or phone.
                            </p>
                          </div>
                          <Switch
                            checked={form.allowPublish}
                            onChange={(on) => set('allowPublish', on)}
                            label="Show my feedback on the website"
                            className="mt-0.5"
                          />
                        </div>

                        {/* More, for those who want it */}
                        <div className="rounded-xl border border-border">
                          <button
                            type="button"
                            onClick={() => setMoreOpen((o) => !o)}
                            aria-expanded={moreOpen}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium"
                          >
                            <span>
                              Add more details{' '}
                              <span className="font-normal text-muted-foreground">
                                — scores, order number, a way to reply
                              </span>
                            </span>
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 shrink-0 transition-transform',
                                moreOpen && 'rotate-180',
                              )}
                              aria-hidden="true"
                            />
                          </button>
                          <AnimatePresence initial={false}>
                            {moreOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="space-y-4 border-t border-border p-4">
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {ASPECTS.map((aspect) => (
                                      <div
                                        key={aspect.key}
                                        className="flex items-center justify-between gap-3 rounded-lg bg-background/40 px-3 py-2"
                                      >
                                        <span className="text-sm">{aspect.label}</span>
                                        <StarRating
                                          value={form.aspects[aspect.key] ?? 0}
                                          onChange={(v) =>
                                            set('aspects', { ...form.aspects, [aspect.key]: v })
                                          }
                                          size="sm"
                                          label={aspect.label}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="grid gap-4 sm:grid-cols-3">
                                    <Input
                                      label="Order number"
                                      value={form.orderNumber}
                                      placeholder="FB-…"
                                      onChange={(e) => set('orderNumber', e.target.value)}
                                    />
                                    <Input
                                      label="Email"
                                      type="email"
                                      value={form.email}
                                      error={errors.email}
                                      placeholder="If you'd like a reply"
                                      onChange={(e) => set('email', e.target.value)}
                                    />
                                    <Input
                                      label="Phone"
                                      value={form.phone}
                                      placeholder="03XX XXXXXXX"
                                      error={errors.phone}
                                      onChange={(e) => set('phone', e.target.value)}
                                    />
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Honeypot for bots: hidden from people and screen readers. */}
                        <input
                          type="text"
                          name="website"
                          value={form.website}
                          onChange={(e) => set('website', e.target.value)}
                          tabIndex={-1}
                          autoComplete="off"
                          aria-hidden="true"
                          className="absolute left-[-9999px] h-0 w-0 opacity-0"
                        />

                        <Button
                          type="submit"
                          size="lg"
                          leftIcon={Send}
                          isLoading={isSending}
                          loadingText="Sending…"
                          fullWidth
                        >
                          Send feedback
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* ---------------- What others said ---------------- */}
        <aside className="space-y-4">
          {published?.summary?.count > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Our score
              </h2>
              <ScoreSummary summary={published.summary} />
            </div>
          )}
          {items.length > 0 ? (
            items.slice(0, 4).map((item) => <FeedbackCard key={item.id} item={item} />)
          ) : (
            <div className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">
              Published feedback from customers appears here.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TagChip({ label, selected, fix = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? fix
            ? 'border-warning bg-warning/15 text-warning'
            : 'border-gold bg-gold/15 text-gold'
          : 'border-border-strong text-muted-foreground hover:border-gold/60 hover:text-foreground',
      )}
    >
      {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </button>
  );
}

export default FeedbackPage;
