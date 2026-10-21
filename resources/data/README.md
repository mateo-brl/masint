# Données embarquées

## sherlock-sites.json

Base des sites utilisée par les modules `username.sites` et `username.sites_nsfw`
(recherche d'un pseudo sur plusieurs centaines de sites).

- Source : projet Sherlock, https://github.com/sherlock-project/sherlock
- Fichier d'origine : `sherlock_project/resources/data.json`
- Instantané : commit `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3`, récupéré le 21/10/2026
- Contenu : 481 sites, dont 19 marqués `isNSFW`
- Fichier copié sans modification. Les exclusions sont faites dans le code
  (`src/main/modules/username/_sherlock.ts`, constante `BLACKLIST`).

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
