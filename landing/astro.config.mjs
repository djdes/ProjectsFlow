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
  server: {
    port: 4321,
    host: true,
  },
  vite: {
    ssr: {
      // three.js пакет ESM/CJS бывает капризным, прокидываем через ssr.noExternal.
      noExternal: ['three', '@react-three/fiber', '@react-three/drei'],
    },
  },
});
