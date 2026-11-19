import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    // Three.js représente l'essentiel du bundle (~570 Ko) : taille attendue.
    chunkSizeWarningLimit: 800,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Atelier 3D — Meubles en bois massif',
        short_name: 'Atelier 3D',
        description: 'Concevez vos meubles en bois massif directement dans votre pièce.',
        lang: 'fr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1f1a16',
        theme_color: '#8b5a2b',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
    }),
  ],
});
