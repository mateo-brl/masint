<p align="center">
  <img src="build/icons/128x128.png" width="96" height="96" alt="Logo MASINT">
</p>

<h1 align="center">MASINT</h1>

<p align="center">
  Application de bureau d'enquête en sources ouvertes (OSINT), organisée autour d'un graphe.
  <br>
  Windows et Linux · français et anglais · licence Apache-2.0
</p>

<p align="center">
  <a href="https://github.com/mateo-brl/masint/actions/workflows/ci.yml"><img src="https://github.com/mateo-brl/masint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/mateo-brl/masint/releases/latest"><img src="https://img.shields.io/github/v/release/mateo-brl/masint?label=version" alt="Dernière version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-Apache--2.0-blue" alt="Licence Apache-2.0"></a>
</p>

*[English version below](#english)*

## Présentation

MASINT part d'une donnée (adresse email, numéro de téléphone, pseudo, domaine, adresse IP,
IBAN, portefeuille crypto...) et la fait grandir en **graphe d'entités reliées** : chaque
entité peut être enrichie par des modules qui interrogent des sources publiques ou les services
pour lesquels vous avez une clé. Les résultats arrivent sous forme de nouveaux nœuds et de liens,
que l'on organise, annote et exporte.

L'application est inspirée de [Flowsint](https://github.com/reconurge/flowsint) pour le graphe
et de [roso.info](https://roso.info) pour les recherches, avec une priorité : tout reste
**sur votre machine**. Pas de compte, pas de serveur MASINT, pas de télémétrie.

## Fonctionnalités

- **Graphe d'enquête** : entités, liens annotés, textes, images, cartes et dessins à main levée
  sur le même canevas ; dispositions automatiques, styles, annuler et rétablir, raccourcis
  clavier.
- **Catalogue de plus de 370 icônes** de types d'entités et de plateformes (réseaux sociaux,
  messageries, opérateurs, hébergeurs, banques, cryptomonnaies...), en 14 catégories.
- **Modules d'enrichissement** classés par famille : téléphone, email, pseudo, personne,
  domaine, IP, web, crypto, finance, entreprise, localisation, image, messagerie, réseaux
  sociaux, forensic (hashes, CVE, IOC). Vérifications de comptes silencieuses, recherche de
  pseudo sur des centaines de sites, DNS, WHOIS / RDAP, certificats, fuites de données,
  géolocalisation, EXIF... La liste complète est dans
  [docs/modules-list.md](docs/modules-list.md).
- **Connecteur roso.info**, à la demande uniquement, avec votre propre compte et vos crédits
  (voir [docs/roso.md](docs/roso.md)).
- **Proxy et Tor** : toutes les requêtes des modules et les tuiles de carte passent par le
  réseau choisi (direct, proxy HTTP, SOCKS5 ou Tor), DNS compris (DNS-over-HTTPS). Routage
  ajustable module par module.
- **Carte** des entités géolocalisées et **frise chronologique** des dates trouvées.
- **Notes** d'enquête en Markdown.
- **Exports** : image PNG ou SVG du graphe, JSON, CSV (nœuds et liens), page HTML interactive
  autonome.
- **Rapport PDF** prêt à imprimer : synthèse, capture du graphe, fiches des entités, notes et
  traçabilité des modules.
- **Archives `.masint`** : une enquête complète (pièces jointes comprises) dans un seul
  fichier, à partager ou à rouvrir par double-clic.
- **Interface en français et en anglais**, thème sombre ou clair.
- **Mises à jour automatiques** depuis les releases GitHub.

## Installation

Les installeurs sont publiés sur la page des
[releases](https://github.com/mateo-brl/masint/releases/latest).

### Windows 10 et 11 (64 bits)

1. Téléchargez `MASINT-Setup-<version>.exe` et lancez-le.
2. L'exécutable n'est **pas signé** : Windows SmartScreen affiche « Windows a protégé votre
   ordinateur ». Cliquez sur **Informations complémentaires** puis **Exécuter quand même**.
3. L'installeur (en français si Windows l'est) vous laisse choisir une installation pour vous
   seul ou pour tous les utilisateurs et le dossier d'installation, puis crée les raccourcis
   du bureau et du menu Démarrer.

La désinstallation se fait depuis *Paramètres > Applications*. Elle vous demande si vos
enquêtes et réglages doivent être supprimés aussi ; par défaut, ils sont conservés.

### Linux (64 bits)

**Paquet .deb** (Debian, Ubuntu, Mint...), recommandé sur Ubuntu 24.04 et plus récent :

```bash
sudo apt install ./masint_<version>_amd64.deb
```

**AppImage** (toutes distributions) :

```bash
chmod +x MASINT-<version>-x86_64.AppImage
./MASINT-<version>-x86_64.AppImage
```

L'AppImage a besoin de FUSE 2 (`sudo apt install libfuse2`, ou `libfuse2t64` sur Ubuntu 24.04).
Si elle refuse de démarrer à cause du bac à sable de Chromium (restrictions AppArmor d'Ubuntu
24.04), préférez le paquet .deb, qui installe le profil AppArmor nécessaire.

## Démarrage rapide

1. Sur l'écran d'accueil, saisissez une donnée (email, numéro, pseudo, domaine...) puis
   **Lancer** : MASINT reconnaît son type et crée une enquête.
2. Sélectionnez le nœud : le panneau de droite affiche sa fiche et les modules applicables.
   **Enrichir** les lance ; les résultats apparaissent dans le graphe au fil de l'eau.
3. Recommencez sur les nouveaux nœuds intéressants, reliez, annotez, dessinez.
4. Basculez sur la **carte** ou la **frise** depuis la barre de gauche ; consignez vos pistes
   dans les **notes**.
5. Exportez le graphe, générez le rapport PDF ou enregistrez l'archive `.masint`.

L'option *Enrichissement automatique* (Paramètres > Général) lance les modules dès qu'une
entité est ajoutée. Les modules marqués « à la demande » (services à crédits) ne partent
jamais seuls.

## Configuration

### Résultats à vérifier et recherche assistée

Les hypothèses (pseudos générés, homonymes...) et les recherches qu'un module ne peut pas faire
seul attendent dans **À vérifier** (fiche du nœud, compteur dans la barre du haut) : seul ce que
l'enquêteur valide entre dans le graphe. Une recherche manuelle (Google, annuaire inversé,
Truecaller...) peut être lancée dans MASINT avec **Chercher** : la page s'ouvre dans un navigateur
intégré, à travers le proxy ou Tor configuré, avec une session gardée d'une fois sur l'autre ; la
fenêtre ne s'affiche que si un captcha ou une connexion le demande, et seuls les résultats qui
contiennent la valeur cherchée sont proposés.

### Clés API

Certains modules demandent une clé (Have I Been Pwned, Shodan, VirusTotal, roso.info...). Elles
se saisissent dans **Paramètres > Clés API**, avec pour chacune un lien vers la page où
l'obtenir et la liste des modules qui l'utilisent. Les clés sont chiffrées par le coffre du
système (DPAPI sous Windows, trousseau GNOME ou KWallet sous Linux) et ne sont envoyées qu'au
service concerné. Un module dont la clé obligatoire manque n'est simplement pas proposé.

Pour roso.info, le bouton **Vérifier** contrôle la clé et affiche les crédits restants sans en
consommer. Sous Linux, un avertissement apparaît si aucun trousseau (GNOME Keyring, KWallet)
n'est disponible : les clés sont alors stockées avec un chiffrement faible.

### Réseau, proxy et Tor

Dans **Paramètres > Réseau et Tor**, choisissez Direct, Proxy HTTP, SOCKS5 ou Tor, puis
**Tester la connexion** pour vérifier l'adresse IP de sortie.

- **Windows** : lancez [Tor Browser](https://www.torproject.org/download/) et laissez-le
  ouvert, puis réglez le port SOCKS de Tor sur **9150**. (Le Tor Expert Bundle, s'il est
  installé comme service, écoute sur 9050.)
- **Linux** : installez le service Tor, qui écoute sur le port **9050** :

  ```bash
  sudo apt install tor
  sudo systemctl enable --now tor
  ```

Certains services bloquent les sorties Tor : la vue Modules permet de forcer, module par
module, la connexion directe ou le proxy.

### Mises à jour

MASINT vérifie au démarrage si une nouvelle version est publiée, la télécharge en arrière-plan
et l'installe à la fermeture (désactivable dans Paramètres > À propos). Les mises à jour
automatiques concernent l'installeur Windows et l'AppImage ; le paquet .deb demande le mot de
passe administrateur pour s'installer.

### Où sont mes données ?

Tout est stocké localement, dans une base SQLite (`masint.db`) avec les pièces jointes :

| Système | Dossier |
| --- | --- |
| Windows | `%APPDATA%\MASINT` |
| Linux | `~/.config/MASINT` |

Sauvegardez ce dossier, ou exportez vos enquêtes en archives `.masint`.

## Développement

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
| `npm run modules:list` | Régénère [docs/modules-list.md](docs/modules-list.md). |

Pour écrire un module d'enrichissement, suivez le guide [docs/modules.md](docs/modules.md).
Les contributions sont décrites dans [CONTRIBUTING.md](CONTRIBUTING.md).

### Publier une version

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

2. Le workflow [Release](.github/workflows/release.yml) se déclenche sur le tag `v*` : il
   vérifie que le tag correspond à `package.json`, crée une release GitHub en brouillon,
   construit l'installeur Windows et les paquets Linux, les téléverse avec `latest.yml` et
   `latest-linux.yml` (lus par les applications installées pour se mettre à jour), puis
   publie la release. Un tag comme `v0.3.0-beta.1` est publié en préversion.

3. Relisez les notes de version générées automatiquement sur la page de la release.

### Architecture

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

## Mentions légales et éthique

MASINT est un outil de recherche en sources ouvertes. Son usage engage **votre seule
responsabilité** :

- Utilisez-le uniquement dans un **cadre légal** : enquête journalistique, recherche,
  sécurité informatique, vérification diligente, procédure judiciaire, recherche de vos
  propres traces...
- Les données collectées sont souvent des **données personnelles**. En Europe, leur
  traitement relève du **RGPD** : il vous faut une base légale, une finalité précise, la
  minimisation des données, une durée de conservation limitée et des mesures de sécurité.
  Les personnes concernées ont des droits (accès, rectification, effacement, opposition).
- Respectez les **conditions d'utilisation** des services interrogés, leurs quotas et
  leurs politiques d'accès. Certains modules sont marqués « peut alerter la cible » ou
  « expérimental » : lisez leur description avant de les lancer.
- Le connecteur **roso.info** utilise **votre compte**, votre clé et vos crédits, uniquement
  à votre demande. Vous restez seul responsable de son usage au regard des conditions de
  roso.info.
- Aucune garantie n'est donnée sur l'exactitude des résultats : recoupez toujours vos
  sources.

Ce projet n'est affilié à aucun des services interrogés ; les marques et logos cités
appartiennent à leurs propriétaires et servent uniquement à identifier ces services.

## Licence

MASINT est distribué sous [licence Apache 2.0](LICENSE). © 2026 Mateo Baril.
Les composants et données tiers, et leurs licences, sont listés dans [NOTICE](NOTICE).

---

## English

**MASINT** is a desktop application (Windows, Linux) for open-source intelligence (OSINT)
investigations built around a graph. Start from an email address, phone number, username,
domain, IP address, IBAN or crypto wallet; enrichment modules query public sources (or
services you hold an API key for) and add the results as new nodes and links.

**Features**: investigation graph with text, images, maps and freehand drawing; a catalogue of
370+ entity and platform icons in 14 categories; enrichment modules grouped by family (see
[docs/modules-list.md](docs/modules-list.md)); on-demand roso.info connector using your own
account; HTTP, SOCKS5 and Tor routing (DNS included); map and timeline views; PNG, SVG, JSON,
CSV and interactive HTML exports; PDF report; `.masint` archives; French and English
interface; automatic updates. Everything stays on your computer.

**Install**: download the latest [release](https://github.com/mateo-brl/masint/releases/latest).
On Windows, run `MASINT-Setup-<version>.exe`; the executable is not code-signed, so SmartScreen
asks you to click *More info* then *Run anyway*. On Linux, use the `.deb` package
(`sudo apt install ./masint_<version>_amd64.deb`) or the AppImage.

**Tor**: on Windows, keep Tor Browser open and set the Tor SOCKS port to 9150; on Linux,
`sudo apt install tor` (port 9050).

**Development**: Node.js 22, then `npm install`, `npm run dev`, `npm test`
(`LIVE=1 npm test` for network tests), `npm run test:core`, `npm run dist:linux` or
`npm run dist:win`. To write a module, read [docs/modules.md](docs/modules.md) (in French).
To publish a release, bump the version in `package.json` and push a matching `v*` tag.

**Legal**: use MASINT lawfully, comply with data protection law (GDPR in Europe) and with the
terms of the services you query. Licensed under [Apache 2.0](LICENSE).
