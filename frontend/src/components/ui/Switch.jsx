import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils.js';

/**
 * Switch — an on/off control.
 * ---------------------------------------------------------------------------
 * The knob sits inside a padded flex track, so it is always centred and never
 * slides past the edge. Travel is exactly track − padding − knob.
 *
 *   <Switch checked={on} onChange={setOn} label="Show a map" />
 *
 * A real <button role="switch">: Space/Enter toggle it, screen readers hear
 * "on"/"off", and `label` names it when there is no visible text beside it.
 */

const SIZES = {
  sm: { track: 'h-5 w-9', knob: 'h-4 w-4', on: 'translate-x-4' },
  md: { track: 'h-6 w-11', knob: 'h-5 w-5', on: 'translate-x-5' },
  lg: { track: 'h-7 w-[3.25rem]', knob: 'h-6 w-6', on: 'translate-x-6' },
};

export const Switch = forwardRef(function Switch(
  { checked = false, onChange, disabled = false, label, size = 'md', className, ...rest },
  ref,
) {
  const s = SIZES[size] ?? SIZES.md;
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-start rounded-full p-0.5 transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-gold' : 'bg-border-strong',
        s.track,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform duration-200 ease-out',
          s.knob,
          checked ? s.on : 'translate-x-0',
        )}
      />
    </button>
  );
});

/**
 * A labelled on/off row for forms: the words on the left, the switch on the
 * right. Clicking the words toggles it too.
 */
export function SwitchField({ label, description, checked, onChange, disabled = false, className }) {
  const id = useId();
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-xl border border-border bg-background/40 px-3.5 py-3',
        disabled && 'opacity-60',
        className,
      )}
    >
      <label htmlFor={id} className={cn('min-w-0', !disabled && 'cursor-pointer')}>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default Switch;
