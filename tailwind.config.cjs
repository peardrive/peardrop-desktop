/**
 * Tailwind configuration.
 *
 * Every colour is a CSS variable defined per theme in
 * src/renderer/theme/themes.ts (applied as `data-theme` on <html>), so
 * components only ever say `bg-panel` / `text-muted` and never know which
 * theme is active. Channels are stored as "r g b" so opacity modifiers like
 * `bg-accent/15` keep working.
 */
/** @param {string} name */
const token = (name) => `rgb(var(--pd-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        panel: token('panel'),
        tabs: token('tabs'),
        raised: token('raised'),
        field: token('field'),
        line: token('line'),
        fg: token('fg'),
        muted: token('muted'),
        subtle: token('subtle'),
        accent: {
          DEFAULT: token('accent'),
          strong: token('accent-strong'),
          on: token('on-accent')
        },
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        info: token('info'),
        folder: token('folder'),
        star: token('star'),
        online: token('online'),
        inbound: token('inbound')
      },
      fontFamily: {
        // Bundled (src/renderer/assets/fonts); system fonts cover other scripts.
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Tahoma', 'sans-serif']
      },
      borderRadius: {
        card: '10px',
        modal: '16px'
      },
      boxShadow: {
        modal: 'var(--pd-shadow-modal)',
        menu: 'var(--pd-shadow-menu)'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'slide-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--pd-accent) / 0.55)' },
          '100%': { boxShadow: '0 0 0 14px rgb(var(--pd-accent) / 0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'pop-in': 'pop-in 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
        'slide-up': 'slide-up 200ms ease-out',
        'pulse-ring': 'pulse-ring 1.2s ease-out 2'
      }
    }
  },
  plugins: []
}
