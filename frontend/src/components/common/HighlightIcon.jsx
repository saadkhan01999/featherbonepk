import { Award, ChefHat, Clock, Flame, Heart, Leaf, ShieldCheck, Sparkles, Star, Truck } from 'lucide-react';

/** Icons for the owner's "Why Choose Us" cards — keys match HIGHLIGHT_ICONS on the server. */
const ICONS = {
  shield: ShieldCheck,
  leaf: Leaf,
  chef: ChefHat,
  sparkles: Sparkles,
  truck: Truck,
  clock: Clock,
  heart: Heart,
  star: Star,
  flame: Flame,
  award: Award,
};

export function HighlightIcon({ icon, className = 'h-5 w-5' }) {
  const Icon = ICONS[icon] ?? Star;
  return <Icon className={className} aria-hidden="true" />;
}

export default HighlightIcon;
