import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * Tailwind configuration — the code half of the design system.
 * ---------------------------------------------------------------------------
 * Colours resolve to the CSS variables declared in src/index.css, so a single
 * utility (`bg-surface`, `text-gold`) is correct in BOTH themes and re-skinning
 * never requires touching component files.
 *
 * `darkMode: 'class'` — the theme is driven by a class on <html>, set before
 * first paint by the bootstrap script in index.html. Note the suite is
 * dark-FIRST: `dark` is the default and `.light` is the opt-in override, which
 * is the reverse of Tailwind's usual convention.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Page gutters in one place, so every screen lines up at every breakpoint.
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem', xl: '2.5rem' },
      screens: { '2xl': '1440px' },
    },
    extend: {
      screens: {
        // Ultra-wide: dashboards get an extra column instead of stretching.
        '3xl': '1800px',
      },

      colors: {
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        // Elevation ladder: page → surface → surface-raised.
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          hover: 'hsl(var(--surface-hover))',
          raised: 'hsl(var(--surface-raised))',
        },

        // Brand gold. `gold` is the token components should reach for;
        // `primary` is the same value kept for shadcn-style familiarity.
        gold: {
          DEFAULT: 'hsl(var(--gold))',
          soft: 'hsl(var(--gold-soft))',
          deep: 'hsl(var(--gold-deep))',
          foreground: 'hsl(var(--gold-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },

        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 6px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },

      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },

      fontSize: {
        // Display sizes for storefront hero headlines.
        'display-sm': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-lg': ['3.75rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '800' }],
      },

      boxShadow: {
        // Elevation on a near-black canvas can't rely on drop shadows alone —
        // black on black is invisible — so each step pairs a shadow with a
        // subtle light inset that reads as a lit top edge.
        panel: '0 1px 2px 0 rgb(0 0 0 / 0.45), inset 0 1px 0 0 rgb(255 255 255 / 0.03)',
        elevated: '0 12px 32px -12px rgb(0 0 0 / 0.65), inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
        overlay: '0 24px 64px -16px rgb(0 0 0 / 0.75)',
        // Gold glow for the primary CTA hover and the POS scan field when armed.
        gold: '0 0 0 1px hsl(var(--gold) / 0.35), 0 8px 24px -8px hsl(var(--gold) / 0.45)',
      },

      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, hsl(var(--gold-soft)), hsl(var(--gold-deep)))',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Modals scale up from 96% — small enough to feel like it belongs to
        // the page rather than flying in from elsewhere.
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        // Confirmation pulse for "item added" feedback at the till.
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--gold) / 0.5)' },
          '50%': { boxShadow: '0 0 0 8px hsl(var(--gold) / 0)' },
        },
      },

      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'fade-in-up': 'fade-in-up 0.35s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'pulse-gold': 'pulse-gold 0.6s ease-out',
      },

      transitionTimingFunction: {
        // The house easing curve: quick start, soft landing.
        smooth: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
