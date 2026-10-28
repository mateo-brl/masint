# DESIGN.md : MASINT

Direction visuelle de MASINT, transcrite le 2026-10-28 à partir des réponses de Mateo Baril. Les valeurs de couleur sont celles de `src/renderer/src/styles.css`. Les lignes marquées *(déduit)* sont des conséquences tirées de ces réponses : elles peuvent être corrigées.

Dial: ENERGY 1 / RHYTHM 1 / MOTION 2 *(déduit du caractère « salle d'opérations » et du choix des transitions courtes)*

## Identité

- **Produit** : application de bureau d'enquête OSINT par graphe (entités, modules d'enrichissement, carte, frise, rapports).
- **Public** : analystes OSINT aguerris, et aussi journalistes et enquêteurs.
  - *(déduit)* Densité et raccourcis clavier pour les analystes. Libellés clairs pour les autres : aucune action importante ne se cache derrière une icône sans nom ni infobulle.
- **Caractère** : salle d'opérations. Technique, dense, les signaux (tâches en cours, alertes) sont bien visibles.
- **Motif d'identité** : le « M » formé de nœuds reliés (logo et icône de l'application), rouge sur presque noir.

## Couleur

La couleur ne sert qu'aux signaux. Tout le reste est neutre.

| Rôle | Couleur | Usage |
| --- | --- | --- |
| Danger | rouge (`--accent` aujourd'hui) | Suppression, erreurs, échecs. Jamais pour une action ordinaire. |
| En cours, avertissement | ambre (`--warning`) | Modules en cours, budget atteint, éléments à revoir. |
| Réussi | vert (`--success`) | Fin de tâche, mise à jour prête. |
| Sélection, vue active, chemin mis en évidence, action principale | neutre contrasté | Blanc cassé en thème sombre, presque noir en thème clair. La sélection se lit aussi à un contour plus épais. |
| Logo | rouge | Le logo garde son rouge : c'est la seule présence du rouge hors danger. |

- Contraste WCAG AA dans les deux thèmes : 4,5:1 pour le texte, 3:1 pour les arêtes et les contours utiles.

## Thème

- Au premier lancement, le thème suit le système. Clair et sombre restent au choix dans les paramètres.

## Typographie

- **Inter** pour l'interface : elle reste lisible en petit corps dans une interface dense.
- **JetBrains Mono** pour les valeurs (emails, numéros, hashes, adresses) : la chasse fixe aligne les valeurs.

## Icônes

- *(à confirmer, pas encore validé)* Lucide pour l'interface : un seul trait, cohérent dans une interface dense. Logos de plateformes (simple-icons) pour les entités liées à un service.

## Mouvement

- Transitions courtes, de 150 à 180 ms, sur les modales, les menus et les toasts.
- La palette de commandes et les menus contextuels s'ouvrent sans animation : ce sont des gestes répétés.
- Une animation en boucle ne sert qu'à un état réel (module en cours, chargement).
- *(déduit)* Sous `prefers-reduced-motion`, plus de boucle ni de déplacement : seuls restent les fondus.

## Fonds

- Canevas : grille de points, qui sert de repère spatial.
- Accueil et autres écrans : fond uni.
