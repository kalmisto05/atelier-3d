import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Chemins relatifs : l'appli fonctionne à la racine d'un domaine comme dans un sous-dossier
  // (ex. https://pseudo.github.io/atelier-3d/).
  base: './',
  build: {
    // Three.js représente l'essentiel du bundle (~570 Ko) : taille attendue.
    chunkSizeWarningLimit: 800,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Le plugin ajoute de lui-même les icônes et le manifeste au cache : on ne les
      // remet pas dans globPatterns, sinon le cache reçoit des doublons et le service
      // worker refuse de s'installer (« Entry already exists »).
      includeManifestIcons: true,
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
        globPatterns: ['**/*.{js,css,html}', 'favicon.svg'],
      },
    }),
  ],
});
