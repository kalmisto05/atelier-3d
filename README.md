# Atelier 3D

Application web (PWA) pour concevoir des meubles en bois massif directement dans une pièce.
Vite + TypeScript + Three.js, utilisable sur PC et sur téléphone Android.

## Démarrer

```bash
npm install      # une seule fois
npm run dev      # serveur de développement : http://localhost:5173
```

Autres commandes :

| Commande            | Rôle                                                            |
| ------------------- | --------------------------------------------------------------- |
| `npm run build`     | Vérification TypeScript puis build de production dans `dist/`   |
| `npm run preview`   | Sert le build de production (avec service worker) sur le réseau |
| `npm run typecheck` | Vérification TypeScript seule                                   |
| `npm run icons`     | Régénère les icônes PNG de la PWA (`public/icon-*.png`)         |

## Structure

```
src/
  model/      Modèle de données (types, création, validation/migration, store)
  storage/    Sauvegarde IndexedDB et export/import JSON
  viewer/     Scène Three.js (pièce, caméra orbitale)
  ui/         Panneau latéral / tiroir mobile
  main.ts     Assemblage
```

## Modèle de données

`Projet → Maison → Étages → Pièces → Murs (+ ouvertures) / Meubles → Pièces de bois`

- Toutes les longueurs sont en **centimètres**, les angles en degrés.
- Chaque entité a un `id` stable.
- Le fichier JSON porte un `schemaVersion`. Toute évolution incompatible du format doit
  incrémenter `SCHEMA_VERSION` (`src/model/types.ts`) et ajouter une migration dans
  `src/model/migrate.ts` : les anciens fichiers restent ainsi importables.
