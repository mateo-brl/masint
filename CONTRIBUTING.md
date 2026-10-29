# Contribuer à MASINT

Merci de votre intérêt ! Les corrections de bugs, nouveaux modules, traductions et
améliorations de l'interface sont les bienvenus.

## Avant de commencer

- Pour un bug ou une idée de module, ouvrez d'abord une
  [issue](https://github.com/mateo-brl/masint/issues/new/choose) avec le modèle adapté.
- Pour un changement important (nouvelle vue, format de fichier, dépendance), discutons-en
  dans une issue avant d'écrire le code.
- N'incluez **jamais** de données personnelles réelles ni de clé API dans une issue, un
  commit, une fixture ou une capture d'écran.

## Mettre en place l'environnement

```bash
git clone https://github.com/mateo-brl/masint.git
cd masint
npm install
npm run dev
```

Node.js 22 est requis. La liste des commandes est dans
[docs/developpement.md](docs/developpement.md).

## Écrire un module

Le guide complet, avec un exemple et la façon de le tester, est dans
[docs/modules.md](docs/modules.md). En résumé :

- un fichier par module (ou par service) dans `src/main/modules/<famille>/`, découvert
  automatiquement ;
- réseau uniquement via `ctx.fetch` / `ctx.fetchJson` (respect du proxy et de Tor) ;
- textes en français et en anglais ;
- un test hors ligne sur fixture, et un test `LIVE` si le service est public ;
- seules les sources légales sont acceptées : pas de contournement de captcha ni de
  protection, pas de données obtenues illégalement, conditions d'utilisation respectées.

## Style

- TypeScript strict ; `npm run typecheck` doit passer.
- Le code et les commentaires sont en français, les identifiants et les clés de propriétés en
  anglais (`snake_case` pour les propriétés d'entités).
- Pas de nouvelle dépendance sans en avoir discuté : l'application doit rester légère et
  auditable.

## Pull requests

1. Créez une branche depuis `main`.
2. Vérifiez que `npm run typecheck`, `npm test` et `npm run test:core` passent.
3. Si vous avez ajouté ou modifié un module : `npm run modules:list`.
4. Remplissez le modèle de pull request ; la CI vérifie les types, les tests et le build sous
   Linux et Windows.

En contribuant, vous acceptez que votre contribution soit distribuée sous la
[licence Apache 2.0](LICENSE) du projet.
