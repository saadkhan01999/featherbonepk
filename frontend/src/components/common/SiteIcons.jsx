import {
  Clock,
  CreditCard,
  Facebook,
  Ghost,
  Globe,
  Info,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Music2,
  Phone,
  Store,
  Truck,
  Twitter,
  Youtube,
} from 'lucide-react';

/**
 * Icons for the owner's social links and custom fields.
 * The platform and icon keys match the option lists in the settings registry
 * (backend settings.service.js — SOCIAL_PLATFORMS, FIELD_ICONS).
 */

const SOCIAL = {
  facebook: { icon: Facebook, label: 'Facebook' },
  instagram: { icon: Instagram, label: 'Instagram' },
  tiktok: { icon: Music2, label: 'TikTok' },
  youtube: { icon: Youtube, label: 'YouTube' },
  x: { icon: Twitter, label: 'X' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp' },
  linkedin: { icon: Linkedin, label: 'LinkedIn' },
  snapchat: { icon: Ghost, label: 'Snapchat' },
  website: { icon: Globe, label: 'Website' },
  other: { icon: Globe, label: 'Link' },
};

const FIELD = {
  info: Info,
  phone: Phone,
  mail: Mail,
  map: MapPin,
  clock: Clock,
  store: Store,
  truck: Truck,
  card: CreditCard,
};

export function socialMeta(platform) {
  return SOCIAL[platform] ?? SOCIAL.other;
}

/** A round social icon link, opened safely in a new tab. */
export function SocialIconLink({ link, className }) {
  const { icon: Icon, label } = socialMeta(link.platform);
  const name = link.label || label;
  return (
    <a
      href={link.url}
      target="_blank"
      // noopener: the opened tab must not be able to navigate this one.
      rel="noopener noreferrer"
      aria-label={name}
      title={name}
      className={
        className ??
        'flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-muted-foreground transition-colors hover:border-gold hover:text-gold'
      }
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

export function FieldIcon({ icon, className = 'h-4 w-4' }) {
  const Icon = FIELD[icon] ?? Info;
  return <Icon className={className} aria-hidden="true" />;
}

/** Internal paths route in-app; everything else opens in a new tab. */
export function isInternalHref(href = '') {
  return href.startsWith('/') && !href.startsWith('//');
}
