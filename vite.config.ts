import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/language-learning/
const base = '/language-learning/';

export default defineConfig({
  base,
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Deutsch lernen',
        short_name: 'Deutsch',
        description: 'Learn German vocabulary: sets, folders, pronunciation and spaced repetition.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f4f7',
        theme_color: '#f4f4f7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: `${base}index.html`,
        // Dictionary/translation requests are cached per word in IndexedDB instead.
        navigateFallbackDenylist: [/^\/w\//],
        // Level lists, dictionary pieces and bundled texts aren't precached (several MB);
        // each file is cached when first used.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              /^(levels|dict|reading)\//.test(url.pathname.slice(base.length)) && url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'offline-data', expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
