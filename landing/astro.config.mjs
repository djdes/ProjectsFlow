import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://projectsflow.ru',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  markdown: {
    // Подсветка кода в статьях — в обеих темах сайта: светлая по умолчанию, тёмная
    // включается в pages/blog/[...slug].astro по prefers-color-scheme.
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
  server: {
    port: 4321,
    host: true,
  },
});
