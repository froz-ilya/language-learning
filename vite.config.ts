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
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['standalone'],
        prefer_related_applications: false,
        orientation: 'portrait',
        background_color: '#0d1017',
        theme_color: '#0d1017',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Android "Share to Deutsch": opens <base>?title=…&text=…&url=…; main.ts picks the word out.
        share_target: {
          action: base,
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: `${base}index.html`,
        // Dictionary/translation requests are cached per word in IndexedDB instead.
        navigateFallbackDenylist: [/^\/w\//],
        // Level lists, dictionary pieces and bundled texts aren't precached (several MB);
        // each file is cached when first used.
        runtimeCaching: [
          {
            // Index files say which data files exist: always take the fresh one when online, so
            // a new deploy never pairs an old index with renamed pieces. Offline: cached copy.
            urlPattern: ({ url }) =>
              /^(levels|dict)\/index\.json$/.test(url.pathname.slice(base.length)),
            handler: 'NetworkFirst',
            options: { cacheName: 'offline-index', networkTimeoutSeconds: 3 },
          },
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
