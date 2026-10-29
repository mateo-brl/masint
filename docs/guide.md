# Guide d'utilisation

Ce guide complète le [README](../README.md) : fonctionnalités en détail, installation,
réglages (clés API, réseau et Tor, mises à jour) et emplacement des données.

## Fonctionnalités

- **Graphe d'enquête** : entités, liens annotés, textes, images, cartes et dessins à main levée
  sur le même canevas ; dispositions automatiques, styles, annuler et rétablir, raccourcis
  clavier, palette de commandes (Ctrl+K). Fluide jusqu'à plusieurs milliers de nœuds.
- **Analyse** : plus court chemin entre deux nœuds, nœuds pivots, communautés, filtres et
  calques, curseur temporel, vue Tableau avec actions en lot.
- **Provenance** : chaque nœud, lien et propriété garde les modules qui l'ont trouvé et la date ;
  les résultats confirmés par plusieurs sources sont signalés, les hypothèses vont dans
  « À vérifier », et une cotation de fiabilité (A à F, 1 à 6) peut être posée.
- **Enrichissement en chaîne** (facultatif) : les comptes trouvés sont enrichis à leur tour,
  dans une profondeur, un budget et une liste d'arrêt fixés.
- **Preuves** : capture pleine page et archive MHTML des pages consultées, horodatées et
  empreintées (SHA-256), et **journal d'activité** chaîné dont l'intégrité se vérifie.
- **Corrélation entre enquêtes** : une même entité retrouvée dans une autre enquête est
  signalée, recherche dans le contenu de toutes les enquêtes (désactivable).
- **Catalogue de plus de 370 icônes** de types d'entités et de plateformes (réseaux sociaux,
  messageries, opérateurs, hébergeurs, banques, cryptomonnaies...), en 14 catégories.
- **Plus de 200 modules d'enrichissement** classés par famille : téléphone, email, pseudo,
  personne, domaine, IP, web, crypto, finance, entreprise, localisation, image, messagerie,
  réseaux sociaux, forensic (hashes, CVE, IOC). Vérifications de comptes silencieuses,
  recherche de pseudo sur environ 700 sites (7 000 à la demande), DNS, WHOIS / RDAP,
  certificats, fuites de données, sanctions, registres publics français et européens,
  géolocalisation, EXIF... La liste complète est dans
  [liste des modules](modules-list.md).
- **Connecteur roso.info**, à la demande uniquement, avec votre propre compte et vos crédits
  (voir [roso.md](roso.md)).
- **Proxy et Tor** : toutes les requêtes des modules et les tuiles de carte passent par le
  réseau choisi (direct, proxy HTTP, SOCKS5 ou Tor), DNS compris (DNS-over-HTTPS). Routage
  ajustable module par module, un circuit Tor par enquête, navigateur d'enquête intégré
  (WebRTC bloqué), mode passif qui écarte les modules qui contactent la cible.
- **Carte** des entités géolocalisées et **frise chronologique** des dates trouvées.
- **Notes** d'enquête en Markdown.
- **Import** de listes (CSV, texte ou collage) avec association des colonnes aux types.
- **Exports** : image PNG ou SVG du graphe, JSON, CSV (nœuds et liens), page HTML interactive
  autonome, GraphML, GEXF (Gephi) et CSV pour Maltego.
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

## Résultats à vérifier et recherche assistée

Les hypothèses (pseudos générés, homonymes...) et les recherches qu'un module ne peut pas faire
seul attendent dans **À vérifier** (fiche du nœud, compteur dans la barre du haut) : seul ce que
l'enquêteur valide entre dans le graphe. Une recherche manuelle (Google, annuaire inversé,
Truecaller...) peut être lancée dans MASINT avec **Chercher** : la page s'ouvre dans un navigateur
intégré, à travers le proxy ou Tor configuré, avec une session gardée d'une fois sur l'autre ; la
fenêtre ne s'affiche que si un captcha ou une connexion le demande, et seuls les résultats qui
contiennent la valeur cherchée sont proposés.

## Clés API

Certains modules demandent une clé (Have I Been Pwned, Shodan, VirusTotal, roso.info...). Elles
se saisissent dans **Paramètres > Clés API**, avec pour chacune un lien vers la page où
l'obtenir et la liste des modules qui l'utilisent. Les clés sont chiffrées par le coffre du
système (DPAPI sous Windows, trousseau GNOME ou KWallet sous Linux) et ne sont envoyées qu'au
service concerné. Un module dont la clé obligatoire manque n'est simplement pas proposé.

Pour roso.info, le bouton **Vérifier** contrôle la clé et affiche les crédits restants sans en
consommer. Sous Linux, un avertissement apparaît si aucun trousseau (GNOME Keyring, KWallet)
n'est disponible : les clés sont alors stockées avec un chiffrement faible.

## Réseau, proxy et Tor

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

## Mises à jour

MASINT vérifie au démarrage si une nouvelle version est publiée, la télécharge en arrière-plan
et l'installe à la fermeture (désactivable dans Paramètres > À propos). Les mises à jour
automatiques concernent l'installeur Windows et l'AppImage ; le paquet .deb demande le mot de
passe administrateur pour s'installer.

## Où sont mes données ?

Tout est stocké localement, dans une base SQLite (`masint.db`) avec les pièces jointes :

| Système | Dossier |
| --- | --- |
| Windows | `%APPDATA%\MASINT` |
| Linux | `~/.config/MASINT` |

Sauvegardez ce dossier, ou exportez vos enquêtes en archives `.masint`.

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
