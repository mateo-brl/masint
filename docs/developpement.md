# Développement

Mise en place, commandes, publication d'une version et architecture. Les règles de
contribution sont dans [CONTRIBUTING.md](../CONTRIBUTING.md).

## Mise en place

Prérequis : **Node.js 22** et npm. Sous Windows, les outils de compilation C++ (Visual Studio
Build Tools) peuvent être nécessaires si aucun binaire précompilé de better-sqlite3 n'existe
pour la version d'Electron utilisée.

```bash
git clone https://github.com/mateo-brl/masint.git
cd masint
npm install          # recompile aussi better-sqlite3 pour Electron (postinstall)
npm run dev          # application avec rechargement à chaud
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Lance l'application en développement. |
| `npm run typecheck` | Vérifie les types (processus principal et interface). |
| `npm test` | Tests unitaires hors ligne (Vitest), sur des réponses enregistrées. |
| `LIVE=1 npm test` | Ajoute les tests qui interrogent les vrais services (réseau). Sous PowerShell : `$env:LIVE=1; npm test`. |
| `npm run test:core` | Tests du moteur et de la base SQLite, exécutés dans Electron en mode Node (better-sqlite3 est compilé pour Electron). |
| `npm run build` | Compile l'application dans `out/`. |
| `npm run dist:linux` | Construit l'AppImage et le paquet .deb dans `release/`. |
| `npm run dist:win` | Construit l'installeur Windows dans `release/` (à lancer sous Windows). |
| `npm run dist:dir` | Construit l'application non empaquetée, pour un essai rapide. |
| `npm run icons` | Régénère les icônes depuis `build/icon.svg` (nécessite Playwright et Chromium). |
| `npm run modules:list` | Régénère [modules-list.md](modules-list.md). |

Pour écrire un module d'enrichissement, suivez le guide [modules.md](modules.md).

## Publier une version

1. Mettez à jour la version dans `package.json` et créez le tag correspondant :

   ```bash
   npm version 0.2.0      # modifie package.json, crée le commit et le tag v0.2.0
   git push --follow-tags
   ```

   (Ou à la main : modifier `version` dans `package.json`, committer, puis
   `git tag v0.2.0 && git push origin v0.2.0`.)

   Sans tag : onglet **Actions** du dépôt, workflow **Release**, bouton **Run workflow** sur la
   branche à publier. Le tag `v<version de package.json>` est alors créé par GitHub sur le
   commit construit, au moment où la release est publiée.

2. Le workflow [Release](../.github/workflows/release.yml) se déclenche sur le tag `v*` : il
   vérifie que le tag correspond à `package.json`, crée une release GitHub en brouillon,
   construit l'installeur Windows et les paquets Linux, les téléverse avec `latest.yml` et
   `latest-linux.yml` (lus par les applications installées pour se mettre à jour), puis
   publie la release. Un tag comme `v0.3.0-beta.1` est publié en préversion.

3. Relisez les notes de version générées automatiquement sur la page de la release.

## Architecture

```
masint/
├── src/
│   ├── main/                 processus principal (Node.js)
│   │   ├── index.ts          fenêtre, protocole des pièces jointes, archives passées en argument
│   │   ├── ipc.ts            canaux entre l'interface et le processus principal
│   │   ├── db/               base SQLite (better-sqlite3) : enquêtes, nœuds, liens, pièces jointes
│   │   ├── engine/           moteur d'enrichissement : registre, exécution, client HTTP (proxy, Tor, DoH)
│   │   ├── modules/          modules d'enrichissement, un dossier par famille
│   │   ├── archive.ts        archives .masint (zip)
│   │   ├── settings.ts       réglages et coffre des clés API
│   │   └── updater.ts        mises à jour automatiques (electron-updater)
│   ├── preload/              pont sécurisé entre l'interface et le processus principal
│   ├── renderer/             interface React (graphe React Flow, carte Leaflet, frise, exports)
│   └── shared/               types, SDK des modules, types d'entités, plateformes, détection
├── resources/                icône de fenêtre et données embarquées (base de sites Sherlock)
├── build/                    icônes, script NSIS et scripts de build
├── tests/                    tests Vitest, fixtures, tests du moteur (tests/core)
└── docs/                     guide des modules, liste des modules, notes sur roso.info
```

L'interface n'a pas accès à Node.js (`contextIsolation`, `sandbox`) : elle passe par le
preload, qui n'expose que des canaux typés (`src/shared/api.ts`). Les modules s'exécutent dans
le processus principal et ne touchent au réseau qu'à travers le client HTTP du moteur.
