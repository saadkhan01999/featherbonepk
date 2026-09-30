import { useState } from 'react';

import { contactApi } from '@/features/contact/contact.api.js';
import { Phone, Mail, MapPin, Clock, Send, CheckCircle2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, Textarea } from '@/components/ui/Input.jsx';
import { useSiteStore } from '@/features/site/siteContext.jsx';
import { Seo } from '@/components/seo/Seo.jsx';
import { FieldIcon, SocialIconLink } from '@/components/common/SiteIcons.jsx';
import { cn } from '@/lib/utils.js';
import { useOrderingStatus } from '@/features/site/orderingStatus.js';
import { OpenChip } from '@/components/customer/ShopClosed.jsx';
import { mediaUrl } from '@/lib/media.js';

/**
 * Contact us.
 * ---------------------------------------------------------------------------
 * Contact details beside a message form, over a warm restaurant photo with a
 * dark scrim — the reference layout.
 *
 * Everything on it is the owner's, from Website Management:
 *   Contact page     heading, introduction, message form on/off, map on/off
 *                    and the map location
 *   Business details phone, email, address, opening hours
 *   Footer & Social  custom fields marked "Show on Contact page", social icons
 * Messages are stored and appear in the back office (Contact Messages).
 *
 * The banner at the top — picture, how dark it is, and the small label — is
 * set in Website Management → Contact Page.
 */

/** Banner darkness → the flat darken over the picture. */
const BANNER_SHADE = {
  light: 'bg-background/45',
  medium: 'bg-background/65',
  dark: 'bg-background/80',
};

export function ContactPage() {
  const business = useSiteStore((s) => s.business);
  const contact = useSiteStore((s) => s.contact);
  const content = useSiteStore((s) => s.content);
  const ordering = useOrderingStatus();
  const socialLinks = useSiteStore((s) => s.footer.socialLinks) ?? [];
  const customFields = contact.customFields ?? [];
  const showForm = contact.showForm !== false;
  const mapQuery = contact.mapQuery || business.address;

  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [errors, setErrors] = useState({});
  const [isSent, setSent] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState(null);
  /** Quoted back to the customer so they can refer to it if they follow up. */
  const [reference, setReference] = useState(null);

  const update = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  function validate() {
    const next = {};
    if (form.name.trim().length < 2) next.name = 'Please enter your name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (form.phone && !/^03\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) {
      next.phone = 'Enter a valid mobile number (03XXXXXXXXX)';
    }
    if (form.message.trim().length < 10) next.message = 'Please tell us a little more (10+ characters)';
    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    setSendError(null);

    try {
      const result = await contactApi.send(form);
      setReference(result?.reference ?? null);
      setSent(true);
    } catch (error) {
      // Field-level problems land on the inputs; anything else is a banner. A
      // silent failure here is what the old code did, and it is the worst
      // possible outcome for someone reporting a problem with their order.
      if (Array.isArray(error.details)) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
      } else {
        setSendError(error.message ?? 'Could not send your message. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Seo
        title={contact.heading || 'Contact'}
        description={contact.intro || 'Phone, address and opening hours.'}
      />
      {/* ---------------- Restaurant hero ---------------- */}
      <section className="relative flex h-[300px] items-center justify-center overflow-hidden sm:h-[380px] lg:h-[420px]">
        {/* Website Management → Contact Page → Banner picture. */}
        <img
          src={
            mediaUrl(contact.image || content.heroImage || content.aboutImage) ||
            '/images/products/photos/venue-room.jpg'
          }
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/*
          Two stacked scrims, not one. The photo has bright patches, and a
          single overlay either washes the image out or leaves the headline
          unreadable over the light areas. A flat darken plus a vertical
          gradient holds contrast without flattening the picture. How strong
          the darken is, is the owner's choice (Banner darkness).
        */}
        <div className={cn('absolute inset-0', BANNER_SHADE[contact.bannerShade] ?? BANNER_SHADE.medium)} />
        <div className="absolute inset-0 fb-image-scrim" />

        <div className="container relative text-center">
          {contact.bannerLabel !== '' && (
            <span className="inline-flex rounded-full bg-gold-gradient px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-gold-foreground">
              {contact.bannerLabel || 'Contact Us'}
            </span>
          )}
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            {contact.heading || 'Contact Us'}
          </h1>
          {contact.intro && (
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
              {contact.intro}
            </p>
          )}
        </div>
      </section>

      <div className="container py-12">
        <div className={cn('grid gap-10', showForm && 'lg:grid-cols-2')}>
          {/* --- Details --- */}
          <div>
            <h2 className="text-xl font-bold tracking-tight">Contact Details</h2>
            <p className="mt-1 text-sm text-muted-foreground">Call, email, or drop in.</p>

            {/* Owner-entered, and omitted when blank — never a stand-in
                number. See features/site/siteContext.jsx. */}
            <ul className="mt-6 space-y-5">
              {business.phone && (
                <ContactRow icon={Phone} label="Phone">
                  <a href={`tel:${business.phone.replace(/\s/g, '')}`} className="hover:text-gold">
                    {business.phone}
                  </a>
                </ContactRow>
              )}
              {business.email && (
                <ContactRow icon={Mail} label="Email">
                  <a href={`mailto:${business.email}`} className="hover:text-gold">
                    {business.email}
                  </a>
                </ContactRow>
              )}
              {business.address && (
                <ContactRow icon={MapPin} label="Address">
                  {business.address}
                </ContactRow>
              )}
              {ordering?.summary?.length ? (
                <ContactRow icon={Clock} label="Opening Hours">
                  {ordering.summary.map((line) => (
                    <span key={line.days} className="block">
                      <span className="text-foreground">{line.days}</span> · {line.hours}
                    </span>
                  ))}
                  <span className="mt-1.5 block">
                    <OpenChip status={ordering} />
                  </span>
                </ContactRow>
              ) : (
                business.hours && (
                  <ContactRow icon={Clock} label="Opening Hours">
                    {business.hours}
                  </ContactRow>
                )
              )}
              {customFields.map((field, index) => (
                <li key={`${field.label}-${index}`} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/10">
                    <FieldIcon icon={field.icon} className="h-5 w-5 text-gold" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{field.label}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{field.value}</p>
                  </div>
                </li>
              ))}
              {!business.phone && !business.email && !business.address && customFields.length === 0 && (
                <li className="text-sm text-muted-foreground">Use the form and we will get back to you.</li>
              )}
            </ul>

            {socialLinks.length > 0 && (
              <div className="mt-8">
                <p className="text-sm font-semibold">Follow us</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {socialLinks.map((link) => (
                    <SocialIconLink key={link.url} link={link} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* --- Form (the owner can switch it off) --- */}
          {showForm && (
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-elevated">
              {isSent ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center" role="status">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
                    <CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />
                  </span>
                  <h2 className="text-lg font-semibold">Thank you, {form.name.split(' ')[0]}!</h2>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    We&apos;ve received your message and will get back to you within one working day.
                  </p>
                  {/* A reference the customer can quote if they follow up — and
                    proof to them that something was actually recorded. */}
                  {reference && (
                    <p className="text-xs text-muted-foreground">
                      Reference: <span className="font-mono text-foreground">{reference}</span>
                    </p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForm({ name: '', email: '', phone: '', message: '' });
                      setSent(false);
                    }}
                  >
                    Send another message
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  {/* A send failure must be visible. Swallowing it and showing
                    the thank-you screen is what the placeholder did. */}
                  {sendError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{sendError}</span>
                    </div>
                  )}

                  <Input
                    label="Your Name"
                    placeholder="Enter your name"
                    value={form.name}
                    onChange={update('name')}
                    error={errors.name}
                    required
                  />
                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="Enter your email"
                    value={form.email}
                    onChange={update('email')}
                    error={errors.email}
                    required
                  />
                  <Input
                    label="Phone Number"
                    placeholder="03XX XXXXXXX"
                    value={form.phone}
                    onChange={update('phone')}
                    error={errors.phone}
                    hint="Optional — helps us reply faster."
                  />
                  <Textarea
                    label="Your Message"
                    rows={5}
                    placeholder="Type your message…"
                    value={form.message}
                    onChange={update('message')}
                    error={errors.message}
                    required
                  />

                  <Button
                    type="submit"
                    fullWidth
                    size="lg"
                    leftIcon={Send}
                    isLoading={isSubmitting}
                    loadingText="Sending…"
                  >
                    Send Message
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Location ----------------
          Hidden entirely without an address: a map pinned to a hard-coded
          location shows customers the wrong shop, which is worse than no map. */}
      {contact.showMap !== false && mapQuery && (
        <section className="container pb-14" aria-labelledby="find-us">
          <div className="mb-4">
            <h2 id="find-us" className="text-xl font-bold tracking-tight">
              Find Us
            </h2>
            {business.address && <p className="mt-1 text-sm text-muted-foreground">{business.address}</p>}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border">
            <iframe
              title={`Map showing ${business.name} at ${mapQuery}`}
              // Google's keyless embed. `q=` is resolved server-side by Google,
              // so the pin follows the address the owner entered in Settings
              // rather than a hard-coded coordinate pair belonging to whoever
              // this software was first written for.
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=15&output=embed`}
              width="100%"
              height="380"
              style={{ border: 0 }}
              // lazy: the map is below the fold and costs a third-party request.
              loading="lazy"
              // Don't leak the full URL of our page to the map host.
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              className="block w-full"
            />
          </div>

          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(mapQuery)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-gold hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Open in Google Maps
          </a>
        </section>
      )}
    </div>
  );
}

function ContactRow({ icon: Icon, label, children }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/10">
        <Icon className="h-5 w-5 text-gold" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

export default ContactPage;
