## Description

<!-- Ce que change cette PR et pourquoi. Liez l'issue concernée : « Corrige #123 ». -->

## Type de changement

- [ ] Correction de bug
- [ ] Nouveau module ou amélioration d'un module
- [ ] Interface
- [ ] Packaging, CI, documentation

## Vérifications

- [ ] `npm run typecheck` passe
- [ ] `npm test` et `npm run test:core` passent
- [ ] Pour un module : test avec fixture dans `tests/` (et test `LIVE=1` si le service est public)
- [ ] Pour un module : `node build/scripts/list-modules.mjs > docs/modules-list.md` relancé
- [ ] Textes de l'interface en français et en anglais
- [ ] Aucune donnée personnelle réelle ni clé API dans le code, les fixtures ou les captures

## Captures

<!-- Pour un changement visible dans l'interface. -->
