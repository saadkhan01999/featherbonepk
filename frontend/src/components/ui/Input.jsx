import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * Form input primitives.
 * ---------------------------------------------------------------------------
 * Every field is wired for accessibility by default, because these are the
 * details that get skipped under deadline and then cost a rewrite:
 *
 *  • the <label> is bound to the control via a generated id
 *  • errors are linked with aria-describedby and aria-invalid, so a screen
 *    reader announces the problem instead of just "invalid"
 *  • the error is text, never colour alone
 *  • hint and error share one slot, so the layout height doesn't jump when a
 *    validation message appears mid-form
 */

const BASE_FIELD = cn(
  'w-full rounded-lg border bg-surface px-3.5 text-sm text-foreground',
  'placeholder:text-muted-foreground/60',
  'transition-colors duration-200',
  'focus:outline-none focus:ring-2 focus:ring-ring/60 focus:border-gold',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/** Shared label + hint/error wrapper so all controls align identically. */
function Field({ id, label, error, hint, required, children, className }) {
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      {children}

      {/* One slot for both messages — an error replaces the hint rather than
          appearing beneath it and pushing the next field down. */}
      {(error || hint) && (
        <p
          id={`${id}-description`}
          className={cn('text-xs leading-snug', error ? 'text-destructive' : 'text-muted-foreground')}
          // Errors are announced as they appear; hints are static text.
          role={error ? 'alert' : undefined}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input(
  { label, error, hint, className, containerClassName, icon: Icon, required, id: idProp, ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-description` : undefined}
          className={cn(
            BASE_FIELD,
            'h-10',
            Icon && 'pl-9',
            error
              ? 'border-destructive focus:border-destructive focus:ring-destructive/40'
              : 'border-border-strong',
            className,
          )}
          {...props}
        />
      </div>
    </Field>
  );
});

/**
 * PasswordInput — adds a show/hide toggle.
 * The toggle is a real <button> (not a div): it must be reachable by keyboard,
 * and its aria-label changes with state so it is announced correctly.
 */
export const PasswordInput = forwardRef(function PasswordInput(
  { label = 'Password', error, hint, className, containerClassName, required, id: idProp, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-description` : undefined}
          className={cn(
            BASE_FIELD,
            'h-10 pr-10',
            error
              ? 'border-destructive focus:border-destructive focus:ring-destructive/40'
              : 'border-border-strong',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, error, hint, className, containerClassName, rows = 4, required, id: idProp, ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-description` : undefined}
        className={cn(
          BASE_FIELD,
          'resize-y py-2.5 leading-relaxed',
          error
            ? 'border-destructive focus:border-destructive focus:ring-destructive/40'
            : 'border-border-strong',
          className,
        )}
        {...props}
      />
    </Field>
  );
});

/**
 * Select — a native <select>, deliberately.
 * A custom listbox would style more freely but has to reimplement keyboard
 * navigation, type-ahead and the mobile OS picker. The native control gets all
 * of that for free and is what a phone user expects.
 */
export const Select = forwardRef(function Select(
  {
    label,
    error,
    hint,
    className,
    containerClassName,
    children,
    placeholder,
    required,
    id: idProp,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-description` : undefined}
        className={cn(
          BASE_FIELD,
          'h-10 cursor-pointer appearance-none bg-[length:16px] bg-[right:0.75rem_center] bg-no-repeat pr-9',
          error ? 'border-destructive' : 'border-border-strong',
          className,
        )}
        // Inline chevron as a data URI: keeps the control one element, so the
        // native picker still opens from anywhere in the field.
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a8a29b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
    </Field>
  );
});

/** Search field — used by the storefront header and the POS product search. */
export const SearchInput = forwardRef(function SearchInput({ className, ...props }, ref) {
  return <Input ref={ref} type="search" icon={Search} className={className} {...props} />;
});

/**
 * Checkbox — accent-coloured so it picks up the brand gold without a custom
 * control (and therefore without reimplementing indeterminate state).
 */
export const Checkbox = forwardRef(function Checkbox({ label, className, id: idProp, ...props }, ref) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <div className="flex items-center gap-2.5">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          'h-4 w-4 shrink-0 cursor-pointer rounded border-border-strong bg-surface accent-gold',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className,
        )}
        {...props}
      />
      {label && (
        <label htmlFor={id} className="cursor-pointer select-none text-sm text-foreground">
          {label}
        </label>
      )}
    </div>
  );
});

export default Input;
