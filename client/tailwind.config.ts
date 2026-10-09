import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import tailwindcssAnimate from 'tailwindcss-animate';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const typographyPlugin = require('@tailwindcss/typography');

// Логические утилиты блочной оси (good-css «Logical properties»): вместо mt/mb/pt/pb,
// top/bottom, border-t/b, rounded-t/b пишем mbs/mbe/pbs/pbe, inset-bs/be, border-bs/be,
// rounded-bs/be. В Tailwind 3.4 есть только inline-ось (ms/me/ps/pe/start/end/border-s…);
// блочные появились в 4.2 под теми же именами — при переезде плагин просто удаляется.
const logicalBlock = plugin(({ matchUtilities, theme }) => {
  matchUtilities(
    {
      mbs: (value) => ({ marginBlockStart: value }),
      mbe: (value) => ({ marginBlockEnd: value }),
    },
    { values: theme('margin'), supportsNegativeValues: true },
  );
  matchUtilities(
    {
      pbs: (value) => ({ paddingBlockStart: value }),
      pbe: (value) => ({ paddingBlockEnd: value }),
    },
    { values: theme('padding') },
  );
  matchUtilities(
    {
      'inset-bs': (value) => ({ insetBlockStart: value }),
      'inset-be': (value) => ({ insetBlockEnd: value }),
    },
    { values: theme('inset'), supportsNegativeValues: true },
  );
  matchUtilities(
    {
      'border-bs': (value) => ({ borderBlockStartWidth: value }),
      'border-be': (value) => ({ borderBlockEndWidth: value }),
    },
    { values: theme('borderWidth'), type: ['line-width', 'length'] },
  );
  matchUtilities(
    {
      'rounded-bs': (value) => ({ borderStartStartRadius: value, borderStartEndRadius: value }),
      'rounded-be': (value) => ({ borderEndStartRadius: value, borderEndEndRadius: value }),
    },
    { values: theme('borderRadius') },
  );
  matchUtilities(
    {
      'scroll-mbs': (value) => ({ scrollMarginBlockStart: value }),
      'scroll-mbe': (value) => ({ scrollMarginBlockEnd: value }),
    },
    { values: theme('scrollMargin'), supportsNegativeValues: true },
  );
  matchUtilities(
    {
      'scroll-pbs': (value) => ({ scrollPaddingBlockStart: value }),
      'scroll-pbe': (value) => ({ scrollPaddingBlockEnd: value }),
    },
    { values: theme('scrollPadding') },
  );
});

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // hover:-варианты — только там, где hover есть (мышь/тачпад): на телефоне тап больше не
  // оставляет «залипший» ховер (good-css «Hover styles only where hover exists»).
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      fontFamily: {
        // Системный стек Notion 1:1 — без веб-шрифтов (см. план Phase 0/0.1).
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI Variable Display"',
          '"Segoe UI"',
          'Helvetica',
          '"Apple Color Emoji"',
          'Arial',
          'sans-serif',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      // Шкала размеров текста. 2xs (11px) — мета, бейджи, счётчики; мельче 11px обычный
      // текст не бывает (8–10px остаются только внутри аватаров и точек-счётчиков, где
      // размер задаёт сам кружок).
      // Только размер, без line-height: строка наследует высоту родителя, как раньше у
      // text-[11px], поэтому замена на токен ничего не сдвигает.
      fontSize: {
        '2xs': '0.6875rem',
        // Растущие с экраном заголовки (good-css «Fluid sizes with clamp()»): одна запись
        // вместо лестницы брейкпоинтов. Точки замера: title — 22px на 320px и 32px от 640px
        // (заголовок проекта); display — 30px на 375px и 36px от 768px (титул страницы ИИ).
        title: 'clamp(1.375rem, 0.75rem + 3.125vw, 2rem)',
        display: 'clamp(1.875rem, 1.517rem + 1.527vw, 2.25rem)',
      },
      colors: {
        border: 'oklch(var(--border) / <alpha-value>)',
        input: 'oklch(var(--input) / <alpha-value>)',
        ring: 'oklch(var(--ring) / <alpha-value>)',
        background: 'oklch(var(--background) / <alpha-value>)',
        foreground: 'oklch(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'oklch(var(--primary) / <alpha-value>)',
          foreground: 'oklch(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'oklch(var(--secondary) / <alpha-value>)',
          foreground: 'oklch(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'oklch(var(--muted) / <alpha-value>)',
          foreground: 'oklch(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'oklch(var(--accent) / <alpha-value>)',
          foreground: 'oklch(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'oklch(var(--destructive) / <alpha-value>)',
          foreground: 'oklch(var(--destructive-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'oklch(var(--success) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'oklch(var(--card) / <alpha-value>)',
          foreground: 'oklch(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'oklch(var(--popover) / <alpha-value>)',
          foreground: 'oklch(var(--popover-foreground) / <alpha-value>)',
        },
        sidebar: 'oklch(var(--sidebar) / <alpha-value>)',
        // Заливка пузыря сообщения пользователя в ИИ-чате.
        'message-bubble': 'oklch(var(--message-bubble) / <alpha-value>)',
        // Notion-style мягкие заливки интерактивных поверхностей (hover/active/selection).
        // Содержат собственную альфу — поэтому var() напрямую, без oklch()-обёртки.
        hover: 'var(--hover)',
        active: 'var(--active)',
        selection: 'var(--selection)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Кривые движения — из токенов motion.css (good-css «Motion tokens»): `transition`
      // и ease-out дают одну и ту же «реакцию», ease-in-out — переезд между состояниями.
      // ease-in в интерфейсе не используем: медленный старт читается как задержка.
      transitionTimingFunction: {
        DEFAULT: 'var(--pf-ease)',
        out: 'var(--pf-ease)',
        'in-out': 'var(--pf-ease-in-out)',
      },
      // Markdown (описания задач, комментарии, ответы ИИ, база знаний) рисуется плагином
      // typography, а у него своя холодная серая палитра: текст был gray-700, жирный и
      // заголовки — почти чёрные gray-900. Рядом с тёплыми Notion-токенами интерфейса это
      // читалось как другой шрифт и «лишняя жирность». Переводим prose на токены приложения;
      // тёмная тема переключает сами токены, поэтому invert-набор — те же значения.
      typography: {
        DEFAULT: {
          css: Object.fromEntries(
            [
              ['body', 'oklch(var(--foreground))'],
              ['headings', 'oklch(var(--foreground))'],
              ['lead', 'oklch(var(--muted-foreground))'],
              ['links', 'oklch(var(--foreground))'],
              ['bold', 'oklch(var(--foreground))'],
              ['counters', 'oklch(var(--muted-foreground))'],
              ['bullets', 'oklch(var(--muted-foreground) / 0.6)'],
              ['hr', 'oklch(var(--border))'],
              ['quotes', 'oklch(var(--foreground))'],
              ['quote-borders', 'oklch(var(--border))'],
              ['captions', 'oklch(var(--muted-foreground))'],
              ['kbd', 'oklch(var(--foreground))'],
              ['code', 'oklch(var(--foreground))'],
              ['th-borders', 'oklch(var(--border))'],
              ['td-borders', 'oklch(var(--border))'],
            ].flatMap(([name, value]) => [
              [`--tw-prose-${name}`, value],
              [`--tw-prose-invert-${name}`, value],
            ]),
          ),
        },
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s var(--pf-ease)',
        'accordion-up': 'accordion-up 0.2s var(--pf-ease)',
      },
    },
  },
  plugins: [tailwindcssAnimate, typographyPlugin, logicalBlock],
};

export default config;
