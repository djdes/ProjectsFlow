import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const typographyPlugin = require('@tailwindcss/typography');

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
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
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
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
        // Сочный янтарный halo. Glow всегда «жирный» и виден — анимируем только маленькую
        // дельту, без скачков альфы. Цель: ощущение живой подсветки, но без эффекта моргания.
        'todo-glow': {
          '0%, 100%': {
            boxShadow:
              '0 0 0 1px rgba(245, 158, 11, 0.70), 0 0 14px 1px rgba(245, 158, 11, 0.45), 0 0 24px 3px rgba(245, 158, 11, 0.22)',
          },
          '50%': {
            boxShadow:
              '0 0 0 1px rgba(245, 158, 11, 0.78), 0 0 18px 2px rgba(245, 158, 11, 0.52), 0 0 30px 4px rgba(245, 158, 11, 0.28)',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        // 6s + linear — равномерное движение без ускорения в середине (это оно
        // воспринималось как «мигание»). Глоу всегда жирный, дельта совсем небольшая.
        'todo-glow': 'todo-glow 6s linear infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate, typographyPlugin],
};

export default config;
