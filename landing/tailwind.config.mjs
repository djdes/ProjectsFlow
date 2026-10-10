/** @type {import('tailwindcss').Config} */
// Маппинг на токены «C4 плотный» из src/styles/tokens.css — те же имена, что у приложения
// (client/tailwind.config.ts), чтобы класс значил одно и то же в обоих местах. Цвета —
// тройки OKLCH, поэтому работают модификаторы прозрачности (`bg-primary/10`). Тёмная тема
// переключает сами переменные (prefers-color-scheme), dark:-варианты не нужны.
const c = (name) => `oklch(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  future: {
    // hover:-варианты — только там, где есть наведение: на телефоне не «залипают».
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      fontFamily: {
        // Системный стек Notion — без веб-шрифтов.
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI Variable Display"',
          '"Segoe UI"',
          'Helvetica',
          'Arial',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': 'var(--text-2xs)',
        meta: 'var(--text-meta)',
        ui: 'var(--text-ui)',
        card: 'var(--text-card)',
        h1: 'var(--text-h1)',
        h2: 'var(--text-h2)',
        h3: 'var(--text-h3)',
      },
      colors: {
        background: c('background'),
        foreground: c('foreground'),
        muted: { foreground: c('muted-foreground') },
        sidebar: c('sidebar'),
        panel: c('panel'),
        card: c('card'),
        raised: c('raised'),
        field: c('field'),
        border: c('border'),
        input: c('input'),
        ring: c('ring'),
        primary: {
          DEFAULT: c('primary'),
          fill: c('primary-fill'),
          foreground: c('primary-foreground'),
          ink: c('primary-ink'),
          soft: 'var(--primary-soft)',
        },
        approval: { DEFAULT: c('approval'), soft: 'var(--approval-soft)', ink: c('approval-ink') },
        manual: { DEFAULT: c('manual'), soft: 'var(--manual-soft)', ink: c('manual-ink'), zone: 'var(--manual-zone)' },
        done: {
          DEFAULT: c('done'),
          soft: 'var(--done-soft)',
          'soft-hover': 'var(--done-soft-hover)',
          ink: c('done-ink'),
        },
        destructive: c('destructive'),
        today: c('today'),
        drop: { DEFAULT: 'var(--drop)', line: c('drop-line') },
        toast: { DEFAULT: c('toast'), foreground: c('toast-foreground'), accent: c('toast-accent') },
        tone: { DEFAULT: 'var(--tone)', bg: 'var(--tone-bg)', fg: 'var(--tone-fg)' },
        hover: 'var(--hover)',
        active: 'var(--active)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        '2xl': 'var(--r-2xl)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        float: 'var(--shadow-float)',
        frame: 'var(--shadow-frame)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-out)',
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },
    },
  },
};
