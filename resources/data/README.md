# Données embarquées

## sherlock-sites.json

Base des sites utilisée par les modules `username.sites`, `username.sites_extended` et
`username.sites_nsfw` (recherche d'un pseudo sur plusieurs centaines de sites), avec la base
Maigret décrite plus bas.

- Source : projet Sherlock, https://github.com/sherlock-project/sherlock
- Fichier d'origine : `sherlock_project/resources/data.json`
- Instantané : commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`, récupéré le 21/10/2026
- Contenu : 481 sites, dont 19 marqués `isNSFW`
- Fichier copié sans modification. Les exclusions et corrections sont faites dans le code
  (`src/main/modules/username/_sherlock.ts`, constantes `BLACKLIST` et `OVERRIDES`).
- Correction locale (22/10/2026) : le message d'erreur de Twitch est réduit à la phrase
  `Twitch is the world&#39;s leading video platform and community for gamers.`, car Twitch
  sert la balise `content` tantôt entre apostrophes, tantôt entre guillemets.
- Défis anti-robot reconnus aux en-têtes (22/10/2026) : `x-amzn-waf-action` (AWS WAF, par
  exemple CGTrader qui répond 202 sans corps pour tout pseudo) et `cf-mitigated: challenge`
  (Cloudflare). La réponse est classée « pare-feu », jamais « compte trouvé ».

### Licence

Ce fichier est distribué sous licence MIT :

```
MIT License

Copyright (c) 2019 Sherlock Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Pourquoi Sherlock plutôt que WhatsMyName

WhatsMyName (https://github.com/WebBreacher/WhatsMyName, environ 690 sites) a une
détection plus stricte (chaîne attendue sur la page du compte et chaîne attendue sur la
page d'erreur), mais sa base est sous licence CC BY-SA 4.0 : toute version adaptée de
la base devrait être partagée sous la même licence. La base Sherlock (MIT) s'intègre sans
contrainte dans l'application ; ses faux positifs sont mesurés et écartés ci-dessous.

### Règles de détection

Les règles de Sherlock sont reprises telles quelles : `status_code` (requête HEAD par
défaut), `message` (GET, recherche des messages d'erreur dans la page), `response_url`
(redirections non suivies), `regexCheck` (pseudo incompatible : site non interrogé),
`urlProbe`, `request_method`, `request_payload` (JSON), `headers`, `errorCode`, et
détection des pages de pare-feu (Cloudflare, AWS WAF, PerimeterX).

Écarts volontaires, par prudence :

- en-tête `Accept-Language: en-US` imposé, pour que les messages d'erreur attendus
  (en anglais) apparaissent même si l'application est en français ;
- détection `message` : une réponse HTTP 4xx/5xx sans le message attendu est classée
  « erreur » et non « compte trouvé » (page de blocage, quota) ;
- détection `status_code` : une réponse 403, 429 ou 5xx est classée « erreur » (absence
  non démontrée). Le compte n'est de toute façon pas créé, comme dans Sherlock.

### Faux positifs mesurés et sites écartés

Mesure du 21/10/2026 : trois pseudos aléatoires inexistants (`zq8x7v2kq9w1`,
`qx7m2vz9k4pl3`, `hb3k9wq2zt8n`) et un pseudo réel (`torvalds`), 481 sites, concurrence 16,
délai 12 s par site.

| Pseudo | Trouvé | Absent | Pseudo refusé par le site | Pare-feu | Erreur |
| --- | --- | --- | --- | --- | --- |
| zq8x7v2kq9w1 | 35 | 376 | 3 | 25 | 42 |
| qx7m2vz9k4pl3 | 35 | 376 | 5 | 24 | 41 |
| hb3k9wq2zt8n | 36 | 379 | 3 | 25 | 38 |
| torvalds | 116 | 298 | 1 | 25 | 41 |

Avant exclusion, 35 sites (7,3 %) déclaraient systématiquement un compte pour un pseudo
inexistant, et un (igromania) de façon intermittente. Ces 36 sites, plus HudsonRock (qui
signale une présence dans des journaux d'infostealers et non un compte), sont exclus.

Après exclusion, mesure avec les modules eux-mêmes (425 sites pour `username.sites`, 19
pour `username.sites_nsfw`, environ 30 s et 8 s) :

| Pseudo | Module | Trouvé | Absent | Pare-feu | Erreur ou blocage |
| --- | --- | --- | --- | --- | --- |
| hb3k9wq2zt8n | username.sites | 0 | 286 | 23 | 113 |
| hb3k9wq2zt8n | username.sites_nsfw | 0 | 12 | 2 | 5 |
| torvalds | username.sites | 73 | 213 | 23 | 115 |
| torvalds | username.sites_nsfw | 6 | 6 | 2 | 5 |

La colonne « erreur ou blocage » est plus élevée qu'avant exclusion parce que les réponses
403, 429 et 5xx y sont désormais comptées (voir les écarts ci-dessus) ; ces sites ne
produisent jamais de compte.

Sites exclus : 7Cups, Apple Developer, Apple Discussions, Archive.org, Blipfoto,
Championat, Clozemaster, Codolio, EyeEm, F3.cool, GaiaOnline, GeeksforGeeks, Hashnode,
Houzz, Hubski, Ifunny, Instapaper, Odysee, Rarible, Realmeye, Reddit (couvert par le
module `social.reddit`), Scribd, Shelf, SlideShare, Splice, Spotify, Tweakers, Velomania,
Weblate, authorSTREAM, mercadolivre, opennet, social.tchncs.de, svidbook, threads,
igromania, HudsonRock.

Selon l'adresse IP de sortie, une partie des sites ne répond pas ou bloque les requêtes
automatisées (pare-feu, HTTP 403/429) : ils sont listés dans `unreachable` du résultat brut
du module. Refaire la mesure après chaque mise à jour de la base
(`LIVE=1 npx vitest run tests/modules/username_sites.test.ts`).

## maigret-sites.json

Base de sites de Maigret, qui complète Sherlock dans les modules `username.sites` (palier
Essentiel), `username.sites_extended` (palier Étendu, sur demande) et `username.sites_nsfw`.

- Source : projet Maigret, https://github.com/soxoj/maigret
- Fichier d'origine : `maigret/resources/data.json`
- Instantané : commit `eaf820666d15bfd545129f3223e2261c27191e74`, base datée du
  10/10/2026 (`updated_at` de `db_meta.json` : `2026-10-10T20:37:21Z`), récupérée le 22/10/2026
- Empreinte SHA-256 du fichier d'origine :
  `908bac913ad473ca590074a80c7c38d9b133d2af8bf30c313d25dde6a2be5efe` (3,2 Mo, 8 144 entrées)
- Fichier réduit (1,3 Mo) par `node build/scripts/maigret-db.mjs <data.json> <db_meta.json> <commit>` :
  les 699 entrées désactivées et les champs inutilisés (`usernameUnclaimed`, `source`,
  `mirrors`...) sont retirés ; 7 445 entrées et 28 moteurs de forum gardés. La source, la
  licence, la date et l'empreinte d'origine sont dans `$meta`.

### Licence

Ce fichier est distribué sous licence MIT :

```
MIT License

Copyright (c) 2020-2026 Soxoj

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Mise à jour à la demande

Paramètres, onglet Général, « Mettre à jour la base des sites » : MASINT lit
`https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/db_meta.json`
(`updated_at`, `data_url`, `data_sha256`), télécharge la base si elle est plus récente que celle
utilisée, vérifie son empreinte SHA-256 et son schéma, puis l'écrit dans le dossier utilisateur
(`sites/maigret-sites.json`, avec `sites/maigret-sites.meta.json`). Garde-fous : `data_url` en
HTTPS sur un hôte de GitHub uniquement (y compris après redirection), 20 Mo au plus, au moins
1 000 sites, expressions `regexCheck` compilées avec les protections décrites plus bas, et
aucune URL interrogée hors du web public (ni `localhost`, ni adresse privée ou de lien local). Au chargement, la copie n'est utilisée que si son empreinte correspond encore et
qu'elle est plus récente que la base embarquée, qui reste le secours. Les requêtes passent par
le proxy ou Tor des modules de pseudo.

### Règles de détection

Moteur : `src/main/modules/username/_maigret.ts`, mêmes règles que Maigret
(`process_site_result`, `detect_error_page`) :

- fusion des moteurs (`engines[x].site`) : listes ajoutées, dictionnaires complétés, autres
  champs du moteur appliqués seulement si l'entrée ne les fixe pas ; `checkType` vaut
  `status_code` par défaut ;
- URL : `url`, `urlMain`, `urlSubpath` (gabarits `str.format`), `urlProbe` interrogée à la
  place de l'URL affichée, `getParams` ; pseudo encodé comme `urllib.parse.quote` (`/` compris) ;
- `message` : une chaîne de présence (`presenseStrs`, orthographe de Maigret ; aucune chaîne :
  toujours vrai) et aucune chaîne d'absence (`absenceStrs`) ; `status_code` : 2xx ;
  `response_url` : 2xx sans suivre les redirections, et présence ;
- `errors` : une sous-chaîne connue donne une erreur, pas une absence ; pages de protection
  génériques (Cloudflare, DDoS-Guard, Incapsula, Anubis...) et HTTP 401, 403 (sauf
  `ignore403`), 429, 999 et 5xx : pas de conclusion ;
- corps décodé selon le jeu de caractères annoncé (windows-1251 des sites russes) ;
- `headers`, `requestMethod`, `requestPayload` (JSON, ou formulaire selon `Content-Type`) ;
- `regexCheck` converti depuis Python (`(?P<n>)`, `\A`, `\Z`, drapeaux en tête, `{,n}`) ;
  constructions sans équivalent et expressions à quantificateurs imbriqués (risque de ReDoS)
  écartées, contrôle alors sauté ; l'expression n'est appliquée qu'au pseudo, 64 caractères au
  plus. Sur la base embarquée, une seule expression sur 62 est écartée.

Écarts volontaires : `Accept-Language: en-US` imposé, comme pour Sherlock ; une page `message`
en 4xx qui ressemble à un compte est une erreur ; défis signalés par les en-têtes
`x-amzn-waf-action` et `cf-mitigated` classés « pare-feu ».

Sites jamais interrogés : désactivés, autre type d'identifiant que `username` (identifiants
numériques Google, Steam, VK...), `protection` (empreinte TLS, défi JavaScript...),
`activation` (jeton dynamique), protocole `tor`, `i2p` ou `dns`. Les sites à recherche
approximative (`similarSearch`) donnent des comptes « à vérifier ». Les tags `porn`, `nsfw` et
`dating` réservent un site au module `username.sites_nsfw`.

### Paliers

Code : `src/main/modules/username/_catalog.ts`. Dédoublonnage par hôte (sans `www.` ni
`m.`) : un hôte présent dans Sherlock, liste noire comprise, n'est jamais repris de Maigret.

| Palier | Module | Contenu | Sites (base du 10/10/2026) |
| --- | --- | --- | --- |
| Essentiel | `username.sites` (automatique) | Sherlock hors liste noire, plus les sites Maigret classés dans le top 10 000 (`alexaRank`) ou marqués `fr` | 695 (425 Sherlock, 270 Maigret) |
| Étendu | `username.sites_extended` (sur demande) | tous les sites utilisables des deux bases | 7 212 |
| Adultes | `username.sites_nsfw` (sur demande) | sites `isNSFW` de Sherlock, `porn`, `nsfw`, `dating` de Maigret | 55 |

Dans le palier Étendu, seuls les sites du palier Essentiel et les sites classés dans le top
100 000 deviennent des comptes ; les autres (forums Discourse, XenForo, uCoz, wikis, forges)
sont rangés dans la propriété `forums_found` du pseudo, avec `forums_summary` (« 12 comptes sur
des forums et sites peu connus : Discourse 5, XenForo 3, autres 4 »).

### Contrôle témoin et santé des sites

Code : `src/main/modules/username/_health.ts`. Chaque site est interrogé avec son pseudo
témoin public (`username_claimed` de Sherlock, `usernameClaimed` de Maigret), qui doit être
trouvé, et avec un pseudo aléatoire compatible avec son `regexCheck`, qui ne doit pas l'être.
Un site en faux positif ou qui ne trouve plus son témoin est noté « en échec » pendant 7 jours
et sauté par les recherches ; un blocage ou un délai dépassé ne change rien. L'état est propre
à la sortie réseau (`direct`, `tor`, `proxy:<empreinte>`) : un site bloqué en direct peut
fonctionner via Tor. Fichier : `sites/sites-health.json` du dossier utilisateur.

Déclenchement : bouton « Vérifier les sites » des paramètres (palier Essentiel ou Étendu), et
non une tâche hebdomadaire en fond. Raisons : aucune rafale de requêtes vers des milliers de
sites sans action de l'enquêteur, contrôle fait sur la sortie réseau qu'il utilise à ce
moment, annulable ; les échecs expirent d'eux-mêmes après 7 jours.

### Banc de faux positifs

Mesure du 22/10/2026 depuis un bac à sable (sortie par un proxy de centre de données),
contrôle témoin, concurrence 16, délai 12 s par requête
(`BENCH=1 npx vitest run tests/modules/username_bench.test.ts`).

| Palier | Passage | Sites | Corrects | Témoin manqué | Sans conclusion | Faux positifs | Durée |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Essentiel | 1 | 697 | 459 | 61 | 174 | 3 | 56 s |
| Essentiel | 2 (jeu de caractères décodé) | 697 | 463 | 60 | 172 | 2 | 60 s |
| Essentiel | 3 (liste noire appliquée) | 695 | 459 | 63 | 173 | 0 | 59 s |
| Étendu | 1 | 7 239 | 5 573 | 412 | 1 227 | 27 | 12 min 46 s |

« Sans conclusion » regroupe les blocages, pare-feu, délais dépassés et les deux sites dont le
témoin ne respecte pas le format imposé. Proza.ru (faux positif au premier passage) était un
problème d'encodage windows-1251, corrigé. Sites Maigret mis en liste noire
(`MAIGRET_BLACKLIST`) : git.rooty.fr et skeptikon.fr (palier Essentiel, deux passages), et les
27 faux positifs du palier Étendu : Amperka, Aqa, awakening.wiki, community.nanit.com,
Engadget, feminismus.jeannette-hollmann.de, forum.arturia.com, forum.cuba-platform.com,
forum.gumloop.com, forum.mineland.net, forum.moonbeam.network, forum.star-conflict.com,
forum.threefold.io, forum.vivaldi.net, forum.wowcircle.com, forum.y8.com,
forums.triplea-game.org, git.keks.cloud, git.konjactw.dev, git.tcp.direct, quik,
rbxlegacy.wiki, SportsTracker, wiki-es.guildwars2.com, wiki.teamfortress.com, WOW Circle,
yamaya.ru. Aucun site Sherlock n'est en faux positif après la liste noire existante.

Durée des modules, même sortie réseau, pseudo aléatoire (aucun compte ni forum trouvé dans les
deux cas, liste noire appliquée) : `username.sites`, 695 sites en 46 s (concurrence 16, délai
12 s) ; `username.sites_extended`, 7 212 sites en 6 min 21 s (concurrence 24, délai 10 s,
790 erreurs et 328 pare-feu). Avec le pseudo témoin « blue » de Sherlock, `username.sites`
dure 44 s.

Les sites dont le témoin n'est plus trouvé (63 dans le palier Essentiel, dont 53 Sherlock :
Gravatar, PyPi, Roblox, DeviantArt...) ne donnent jamais de faux compte ; le contrôle témoin
de l'utilisateur les met en échec pour 7 jours.
