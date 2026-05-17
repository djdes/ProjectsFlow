/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Палитра подобрана под dark-only лендинг. Совпадает по логике с client/styles/globals.css,
        // но числами короче (без HSL-vars — тут не нужно переключение темы).
        ink: {
          50: '#f4f6fb',
          200: '#aab1bf',
          300: '#7c8694',
          400: '#5b6272',
          500: '#3a4050',
          700: '#1f2330',
          800: '#11141b',
          900: '#0a0b10',
        },
        accent: {
          DEFAULT: '#3b82f6',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          glow: '#1d4ed8',
        },
      },
      boxShadow: {
        glow: '0 0 80px -20px rgba(59,130,246,0.55)',
        'inner-edge': 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'slow-spin': {
          to: { transform: 'rotate(360deg)' },
        },
        'bounce-slow': {
          '0%, 100%': { transform: 'translateY(0)', opacity: '0.5' },
          '50%': { transform: 'translateY(4px)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s ease-out both',
        'fade-up-delay-1': 'fade-up 0.7s ease-out 0.1s both',
        'fade-up-delay-2': 'fade-up 0.7s ease-out 0.25s both',
        'fade-up-delay-3': 'fade-up 0.7s ease-out 0.4s both',
        'pulse-soft': 'pulse 2.5s ease-in-out infinite',
        'slow-spin': 'slow-spin 60s linear infinite',
        'bounce-slow': 'bounce-slow 2.2s ease-in-out infinite',
      },
    },
  },
};
