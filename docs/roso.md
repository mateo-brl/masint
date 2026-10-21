# roso.info dans MASINT

roso.info est un service OSINT français payant à crédits. Son interface web appelle une API
interne non documentée, protégée par une clé personnelle `roso_…` (délivrée aux membres
Patreon, visible sur https://roso.info/account.html). MASINT reproduit les séquences d'appels
du site avec **la clé de l'utilisateur** : c'est son compte, ses crédits, et il reste seul
responsable de l'usage qu'il en fait au regard des conditions d'utilisation de roso.info.

Tous les modules `roso.*` sont **à la demande uniquement** (`ondemand: true`) : ils ne partent
jamais automatiquement à la création d'un nœud, pour ne pas consommer de crédits par surprise.
Ils sont tous marqués `experimental` tant qu'une vraie réponse authentifiée n'a pas été observée.

Pour contrôler une clé sans dépenser de crédit : **Paramètres > Clés API > roso.info > Vérifier**
(route `GET /api/auth/status`). La réponse affiche les crédits, le quota du jour et le niveau, ou
l'erreur renvoyée par roso.info. Une clé invalide donne bien un 401 côté serveur (observé).

Ce document est issu de la lecture du code client public du site (pages HTML avec JS en ligne,
`/_overrides/apigate.js`, `/_overrides/inject.js`, `/_shared/auth-gate.js`,
`/_shared/module-acl-gate.js`, `/_shared/roso-summary.js`, `/ip/ip-enrich-v2.js`,
`/domain/cti-integrated.js`, bundle `/app/assets/index-CAOIqV3w.js` de l'application
téléphone), complétée par quelques requêtes **non authentifiées** le 2026-10-21.

Légende : **[observé]** = réponse réellement reçue ; **[code]** = déduit du code client, à
confirmer avec une vraie clé.

## Sommaire

1. [Généralités : clé, en-têtes, erreurs, crédits](#généralités)
2. [Email](#email)
3. [Pseudo](#pseudo)
4. [Téléphone](#téléphone)
5. [IP](#ip)
6. [Domaine](#domaine)
7. [Nom et prénom](#nom-et-prénom)
8. [Numéro partiel](#numéro-partiel)
9. [Crypto](#crypto)
10. [IBAN](#iban)
11. [Routes non utilisées par MASINT](#routes-non-utilisées)
12. [Implémentation MASINT](#implémentation-masint)
13. [À valider avec une vraie clé](#à-valider)

## Généralités

### Clé et en-têtes

- Base : `https://roso.info` (derrière Cloudflare).
- Clé : stockée par le site dans `localStorage.roso_api_key` (alias `apiKey`, `api_key`,
  `roso_apikey`, `phone_api_key`). Dans MASINT : coffre, identifiant `roso`.
- En-tête `X-API-Key: roso_…` sur toutes les routes authentifiées. Certaines routes prennent
  aussi la clé en paramètre `api_key` (query) ou dans le corps JSON (crypto).
- `X-Session-Id: <sessionId>` pour les modules email (session ouverte par `/start`).
- `X-Roso-Client: phone` pour l'application téléphone.
- Corps en `Content-Type: application/json`. MASINT ajoute `Origin` et `Referer`
  (`https://roso.info/<page>/`) comme le navigateur.

### Compte et métadonnées (sans crédit)

| Route | Rôle | Réponse |
|---|---|---|
| `GET /api/auth/status` (+ `?api_key=`) | validité de la clé, crédits | `{success, credits, credits_remaining?, bonusCredits, dailyUsed, creditsPerDay, tier, admin, email, totalUsed, createdAt, nextDailyReset, nextReset, scanCaptchaRequired?}` [code]. Clé invalide ou absente : **401** `{"success":false,"error":"Clé invalide"}` [observé] |
| `GET /api/auth/module-access?module=<m>&api_key=` | droit d'accès à un module | `{allowed: true\|false, tier, error?}` [code] |
| `GET /api/auth/tier-module-counts?group=email` | catalogue par niveau | public [observé] : `total` 406 modules email ; `normal` 270 modules, 5 crédits/mois ; `boosted` 273, 5/jour ; `patreon` 347, 20/jour |
| `GET /api/maintenance/status?module=<global\|email\|…>` | maintenance | public [observé] : `{"success":true,"maintenance":false,"message":"…","module":"email"}` |
| `GET /api/uc/proxy-image?url=<url>` | proxy d'images | **public, sans clé** [observé : 200 `image/png`] |

### Codes d'erreur

| Statut / code | Sens | MASINT (`ModuleError`) |
|---|---|---|
| 401, `code: api_key_required` | clé absente ou invalide [observé : `{"success":false,"error":"Clé API requise","module":"email","code":"api_key_required"}`] | `auth` « Clé API roso.info invalide » |
| `code: key_expired` / `key_revoked` | clé expirée / révoquée [code] | `auth` |
| 403, `code: module_forbidden` | module non autorisé pour le niveau de la clé [code] | `auth` « module non autorisé » |
| 429 | crédits épuisés [code] | `rate_limited` « Crédits épuisés » |
| 429, `code: free_cooldown`, `free_global_busy`, `free_global_rate` | délai d'attente du niveau gratuit [code] | `rate_limited` « délai d'attente » |
| 400 avec `captcha: true` (`captcha_required`) | captcha exigé (niveau gratuit) [code] | `blocked` : MASINT ne résout pas de captcha |
| `maintenance: true` ou 503 | maintenance [code] | `unavailable` |
| 404 sur un sous-module | module indisponible, compté « non trouvé » par le site [code] | ignoré |
| `code: phone_session_required` | autocheck téléphone sans session `phone/log` [code] | erreur par plateforme |

Captcha : `apigate.js` contient tout le mécanisme (`/api/auth/captcha`, `captchaToken` /
`captchaAnswer` injectés dans le corps des routes de lancement), mais depuis le 2026-09-03 il est
désactivé côté client (« no free keys; GET /api/auth/captcha is 410 »). Les niveaux Boosted et
Patreon en sont exemptés. MASINT ne fait que détecter le cas et l'expliquer.

### Coûts affichés par le site

| Recherche | Coût indiqué |
|---|---|
| Lancement email, pseudo, IP, domaine, nom | 1 crédit par lancement (« Cette recherche consomme 1 crédit ») ; les sous-modules ne semblent pas débités à l'unité |
| Téléphone | lancement `phone/log` (coût non affiché) |
| IBAN | 1 crédit par vérification |
| Numéro partiel | 10 crédits par scan (débités par `/start`) |
| SecurityTrails (domaine, admin) | 1 crédit + 1 crédit pour l'historique A |
| Typosquat (non intégré) | 2 crédits (check) ou 10 (surveillance) |

Les routes de lancement reconnues par le client : `/api/gateway/{username,email,ip,domain,crypto,doc,headers}/start`,
`/api/gateway/{name,face}/search`, `/api/gateway/phone/log`, `/api/gateway/iban/check`,
`/api/gateway/pdl/search`, `/api/gateway/telegram/lookup`.

## Email

Page : `/email/`. Séquence [code] :

1. `GET /api/maintenance/status?module=email`
2. `POST /api/gateway/email/start` corps `{email}` (+ `captchaToken`, `captchaAnswer` si captcha)
   → `{success, sessionId, credits, allowedModules, tier}`. `allowedModules: null` = tous ;
   tableau = liste blanche ; tableau vide = aucun module autorisé.
3. Catalogue : `GET /api/ec/email/meta` (en-têtes `X-API-Key`, `X-Session-Id`)
   → `{enrichmentModules: string[], nonSilentModules: string[]}`. Sans clé : 401 [observé].
   Replis : `GET /api/gateway/graph/email-services.json` → `{services: [{id|name}]}`, puis
   `allowedModules`. Le site ajoute toujours `yahoo`, `protonmail`, `outlookcom`, `hotmailcom`,
   `outlookfr`, `hotmailfr`, met `googlemaps` et `gmail` en tête, retire `spoutible`, `bandlab`,
   `warthunder` et, sauf case cochée, les modules « non silencieux » qui peuvent prévenir la
   cible (`gumroad`, `dragongroot`, `programminghub`, `uber`).
4. Pour chaque module, 12 en parallèle :
   `POST /api/gateway/email/module/<mod>` corps `{email, sessionId}`, en-têtes `X-API-Key`,
   `X-Session-Id`. Délai client 20 s (55 s pour gmail, googlemaps, yahoo, hudsonrock, dehashed,
   facebook ; 35 s tiktok ; 26 s thefork).
   Réponse : `{success, exists, profile: {...}}`. Trouvé si `success === true && exists === true`.
   404 = module indisponible.
5. Rendu : `POST /api/ec/email/render-card` `{module, profile}` → `{html}` (non utilisé par MASINT).
6. Fin : `POST /api/gateway/email/complete` corps `{sessionId, results}` (archivage côté
   roso.info, seulement si au moins un résultat). `results[]` =
   `{platform, type: 'enrichment', profileUrl, displayName, username, avatar, exists, profile}`.

Champs de `profile` lus par le site :

- générique : `displayName`, `fullName`, `firstName`, `lastName`, `username`, `login`, `handle`,
  `email`, `userId`/`uuid`/`uid`/`gaiaId`/`id`, `city`/`location`, `country`, `bio`/`about`,
  `followers`, `profileUrl`/`url`/`website`, photo `avatar`/`profileImage`/`profileImageUrl`/
  `profilePictureUrl`/`photo` (passée par `/api/uc/proxy-image`).
- `googlemaps` : `gaiaId`, `displayName`, `firstName`, `lastName`, `avatar`, `contribUrl`,
  `profileUrl`, `localGuideLevel`, `status`.
- `apple` : `masked_phones[]`, `maskedPhone`, `phoneMasked`, `masked_email`, `multipleEmails`.
- `hibp` : `totalBreaches`, `breaches[]` (`Name`, `Domain`, `BreachDate`, `DataClasses`).
- `intelx` : `totalRecords`, `records[]` (`name`, `date`, `bucket`, `media`, `size`, `viewUrl`).
- `hudsonrock` : `stealerCount`, `totalUserServices`, `stealers[]` (`operatingSystem`/`os`,
  `ip`, `dateCompromised`/`date`, `topLogins`/`credentials`/`services`).
- `whoxy` : `email`, `domain_count`, `primary_domain`, `domains[]` (chaîne ou
  `{domain_name, registrar, created, expiry}`) ; `whoisxml` : `domainsCount`, `otherDomains[]`.
- `tiktok` : `username`/`uniqueId`, `displayName`, `profileImageUrl`, `accountUrl`, `userId`.
- `protonmail` : `pgpFingerprint`, `pgpAlgo`, `pgpCreated` ; `sololearn` : `level`, `xp`,
  `registerDate`...
- pivots de l'export : `twitterUsername`, `phoneHint`, `blog`.

## Pseudo

Page : `/username/`. Séquence [code] :

1. `GET /api/maintenance/status?module=username`
2. `POST /api/gateway/username/start` corps `{username}` → `{success, credits, …}` (le débit).
   Erreurs comme pour l'email (429 + codes de cooldown, 401, 403).
3. **907 vérifications** lancées en parallèle par le site (`Promise.all`) :
   `POST <APIS[site]>` corps `{username}`, en-tête `X-API-Key` (ajouté par un enrobage de
   `fetch` sur `/api/uc/`). Chemin par défaut `/api/uc/<site>/profile`, exceptions :
   `hudsonrock` → `/api/uc/hudsonrock/username`, `ninegag` → `/api/uc/9gag/profile`,
   `wayback` → `/api/uc/wayback/check`, `cosmosso` → `/api/uc/cosmos/profile`,
   `thirtyfivephoto` → `/api/uc/35photo/profile`. Sans clé : 401 [observé].
4. Réponse : `{success, exists, profile|data, emails?, emailCount?}`. Trouvé si
   `success && exists`. `vinted` avec `exists: null` = indisponible. `quora` est retiré si le
   niveau n'est pas patreon / admin / unlimited.
5. Pas d'appel `complete`.

La liste (`const APIS = {…}` et `const platforms = […]`) est dans le HTML public de la page.
Champs les plus lus : `photo` (894 occurrences), `username`, `displayName`, `profileUrl`, `bio`,
`id`, `createdAt`, `followers`, `location`, `userId`, `following`, `joined`, `country`,
`website`, `avatar`... GitHub renvoie en plus `emails[]` (`{email, name, commitUrl, commitSha}`)
au niveau racine. Hudson Rock : `profile.{username, totalCorporateServices, totalUserServices,
stealers[{date_compromised, stealer_family, computer_name, operating_system, ip, top_logins,
total_corporate_services, total_user_services}]}`. Wayback : `profile.{username,
totalPlatformsChecked, totalSnapshots, platforms[{platform, found, waybackFound, totalSnapshots,
snapshots[{date, archiveUrl}], archiveIs{found, archiveUrl}, searchUrls[]}]}`.

## Téléphone

Application React séparée : `/app/phone` → `/app/assets/index-CAOIqV3w.js` (3 Mo). Séquence [code] :

1. `POST /api/gateway/phone/log` corps `{phone}`, en-têtes `X-API-Key`, `X-Roso-Client: phone`.
   C'est la route de lancement (débit, captcha) ; le site l'appelle sans attendre son résultat.
2. 57 plateformes par lots de **3**, **200 ms** entre deux lots :
   `sleeper substack life360 microsoft teams facebook whatsapp telegram signal happn allovoisins
   callapp viewcaller battlenet costar familylocator eyecon hudsonrock amazon reversewhois
   apple-iforgot shotgun airbuds instagram pagesjaunes classpass weward tiktok explurger fishbrain
   samsung boulanger snapchat joinr cleverdialer poteau moovtogo moovbf moovbj moovci pinetwork
   samsunghealth duolingo vsco mapstr aliexpress spamcalls advanceautoparts ajio cvs expensify
   delectable samsungfood twilio phonely callfilter`.
   - cas général : `POST /api/autocheck/check/<plateforme>` corps `{phoneNumber}`, en-têtes
     `X-API-Key`, `X-Roso-Client: phone` → `{exists: true|false|null, data?, message?, error?,
     code?}` (sans clé : 401 `{"module":"phone","code":"api_key_required"}` [observé]).
   - `twilio` : `GET /api/gateway/twilio/lookup/<numéro>?fields=line_type_intelligence,line_status`
     (en-têtes optionnels `X-Twilio-Account-Sid`, `X-Twilio-Auth-Token`) → réponse Twilio
     Lookup v2 (`phone_number`, `national_format`, `country_code`, `line_type_intelligence{type,
     carrier_name, mobile_country_code, mobile_network_code}`, `line_status{status}`),
     éventuellement enveloppée dans `data`.
   - `phonely` (Royaume-Uni seulement) et `callfilter` (France ou Royaume-Uni) :
     `GET /api/gateway/twilio/<plateforme>/<numéro>` → `{success, data, skipped?}`.
3. Si Telegram renvoie `data.userId` : `GET /api/funstat?id=<userId>&api_key=<clé>` (délai 10 s)
   → `{found, error?, …}`.
4. Pas d'appel `complete`. Champs utilisés par l'affichage : `displayName`, `name`, `username`,
   `location`, `firstName`, `lastName`, `avatar`, `email`, `fullName`, `emails`, `city`,
   `address`, `profileImage`, `profilePictureUrl` ; `reversewhois` : `data.domains` /
   `domainList` / `results`.

## IP

Page : `/ip/` + `/ip/ip-enrich-v2.js`. Séquence [code] :

1. `GET /api/maintenance/status?module=ip`
2. `POST /api/gateway/ip/start` corps `{ip}` → `{success, credits}`.
3. En parallèle :
   - `GET /api/gateway/ip/lookup?ip=<ip>` → `{success, ip, country, country_code, continent,
     city, region, postal, timezone, lat, lng, asn, as_name, as_domain, as_route, as_type,
     hostname, company_name, company_domain, company_type, vpn_service, anycast, is_anonymous,
     is_mobile, is_satellite, classification{hosting, cdn, vpn, tor, proxy, relay, anycast},
     maxmind{country, city, subdivision, postal, latitude, longitude, accuracyRadius, isp,
     organization, domain, network, asn, connectionType} | maxmindError}` (IPinfo + MaxMind).
   - 13 sources : `GET /api/ip-preprod/lookup/<source>?ip=<ip>` (délai 60 s) avec `source` parmi
     `bgp virustotal abuseipdb criminalip greynoise abusech otx urlscan intelx hudsonrock
     pulsedive rapiddns iknow` → `{status: 'ok'|'empty'|'error', cached?, fields: [{label, value}],
     records: [{title, detail, url}]}`. Le nom `ip-preprod` laisse penser que la route peut changer.
   - le site appelle aussi `https://rdap.org/ip/<ip>` directement (hors roso.info).

## Domaine

Page : `/domain/` + `/domain/cti-integrated.js`. Séquence [code] :

1. `GET /api/maintenance/status?module=domain`
2. `POST /api/gateway/domain/start` corps `{domain}` → `{success, credits}`.
3. `GET /api/gateway/domain/cti?domain=<d>&visual=1` (65 s) → `{data: {final_url, scanned_at,
   page{title, description, generator, links, scripts}, hops[{url, status, duration_ms, headers,
   addresses, tls}], geo{ip, place, region, timezone, isp, org, coordinates: "lat, lon"},
   whois{domain, created, updated, expires, registry_id, whois_server, registrar, iana_id,
   dnssec, nameservers}, emails[], links{internal_count, external_count, external[]},
   dns{a, aaaa, ns, soa}, passive_dns{names[]}, cookies[], dom{…}, external_resources[],
   checks[{name, present}], browser{screenshot: base64 JPEG}}}`.
4. Puis en parallèle, toutes en `GET ?domain=<d>` avec `X-API-Key` :

| Route | Réponse lue par le site |
|---|---|
| `/api/gateway/domain/rdap` | `{success, data: <RDAP standard>}` ou `{notRegistered: true}` / `error: 'not_registered'` |
| `/api/gateway/domain/crtsh` | `{success, subdomains: string[]}` |
| `/api/gateway/domain/whois-history` | `{success, records[], total_records, cached}` ; record : `create_date`, `update_date`, `expiry_date`, `registrar`, `registrar_iana_id`, `domain_status`, `name_servers`, `registrant_name`, `registrant_email`, `registrant_organization`, `registrant`/`administrative`/`technical` `{name, company, email, phone, fax, street, city, state, zip, country_name, country_code}` (WhoisFreaks) |
| `/api/gateway/domain/intelx` | `{success, result: {totalRecords, foundSummary, headline, records[{date, bucket, media, size, name, viewUrl}], moreCount, searchUrl}}` |
| `/api/gateway/domain/hudsonrock` | `{success, result: {total, employees, users, thirdParties, stealerFamilies[], lastEmployeeCompromised, lastUserCompromised, employeePasswords, userPasswords, logo, headline}}` |
| `/api/gateway/domain/wayback` | `{success, result: {urls[{url, mime, from, to, captures, duplicates, uniques}], truncated, searchUrl}}` |
| `/api/gateway/domain/virustotal` | `{success, result: {positives, scanned, stats{malicious…}, votes{harmless, malicious}, reputation, lastDns[{type, value, ttl}], flagged[{name, result, category}], searchUrl}}` |
| `/api/gateway/domain/urlscan` | `{success, result: {total, took, results[{url, time, size, requests, ips, countries, resultUrl}], searchUrl}}` |
| `/api/gateway/domain/abuseipdb` | `{success, result: {hits[{ip, score, reports, isp, country}]}}` |
| `/api/gateway/domain/otx` | `{success, result: {pulseCount, pulses[{name, id, author, url}], passiveDns[{record_type, type, hostname, address, ip}], searchUrl}}` |

Hors du scan principal : `securitytrails/overview` et `securitytrails/history/a` (réservés aux
administrateurs, contrôle `/api/admin/verify-key`), `favicon` (défini mais non appelé),
`scraper` et `similar` (boutons séparés « scraping seul » et « pivot seul »).

## Nom et prénom

Page : `/name/`. Séquence [code] :

1. `GET /api/maintenance/status?module=name&api_key=<clé>`
2. (facultatif) `GET /api/auth/module-access?module=name&api_key=<clé>` → `{allowed}`.
3. `POST /api/gateway/name/search` corps
   `{firstName, lastName, location, name, fullName, query, q}` (le prénom est le premier mot,
   le nom le reste) → `{success, credits?, query{fullName…}, results[{name, platform, location,
   email, username, phone, profileUrl, avatar, matchSource, matchScore}]}`. `platform` ou
   `matchSource` valant `local`, `search` ou `unknown` = résultat sans plateforme.

## Numéro partiel

Page : `/partial-number/`. Masque avec 1 ou 2 `*` (10 ou 100 combinaisons), 8 à 15 chiffres,
`+indicatif` obligatoire sauf `06` / `07` (France). Séquence [code] :

1. `POST /api/gateway/partial-number/start` corps `{}` → `{success, credits}` : **10 crédits**.
   401/403 → clé, 429 → crédits insuffisants.
2. Pour chaque combinaison, **une requête toutes les 2,5 s** :
   `POST /api/gateway/partial-number/check` corps `{phone: "+33…"}` →
   `{success, results: {<service>: {exists, name, minimal, city, avatar, profileUrl, data{…},
   error, rateLimited, sessionExpired}}}`. Services : `callapp`, `eyecon` (toujours), `allovoisins`
   (France), `poteau`, `cleverdialer`, `moovtogo`, `moovbf`, `moovbj`, `moovci`.
   Hit si `exists === true` et (`name` ou `minimal` ou `city` ou `data` non vide). Erreurs
   `server_<n>` ignorées ; arrêt du scan si `callapp` ou `eyecon` renvoie `rateLimited` ou
   `rate_limit` / `token_invalid`.

## Crypto

Page : `/crypto/`. Pas de route `/start` appelée par cette page. Séquence [code] :

1. `GET /api/gateway/crypto/meta` → `{enrichmentModules[]}` ou `{modules[]}` (chaînes ou
   `{id}`) ou `{moduleMeta{}}`. Sans clé : 401 [observé]. Le site attend environ 139 modules ;
   repli : `ethereum ethtx blockscout ethplorer tokens portfolio nft opensea zora scrollyfi conft
   web3bio blur looksrare rarible magiceden x2y2 foundation element sudoswap okxnft gem debank
   zerion arkham ens labels bitcoin solana intelx hudsonrock`.
2. 12 en parallèle : `POST /api/gateway/crypto/<module>` corps `{address, api_key}` →
   `{success, exists, profile}`. `error: 'invalid_address'` = non applicable.
3. Rendu : `POST /api/gateway/crypto/render-card` (non utilisé par MASINT).

## IBAN

Page : `/iban/`. `POST /api/gateway/iban/check` corps `{iban}` (sans espaces, majuscules), **1 crédit**
→ `{success, credits, result: {ok, valid, iban, bank, bic, country, address, branch_number,
branch_name, sepa{credit_transfer, direct_debit, b2b, instant}, checks[{ok, text}],
data_valid_as_of, detail?, error?}}` (le site lit `d.result || d`). 401 → clé ;
429 avec `credits: 0` → plus de crédits. Sans clé : 401 `{"module":"iban","code":"api_key_required"}` [observé].

## Routes non utilisées

MASINT n'appelle volontairement pas :

- `POST /api/gateway/track` (statistiques de recherche crypto) ;
- `POST /api/gateway/photos/collect` et `POST /api/gateway/identities/collect` : le script
  `roso-summary.js` y envoie, en fin de scan, les photos et identités trouvées (« admin
  collector »). C'est de la télémétrie du site, sans utilité pour l'enquête ;
- les routes de rendu HTML (`/api/ec/email/render-card`, `/api/gateway/crypto/render-card`) ;
- les routes d'administration et les outils non intégrés (typosquat, headers, doc, linkbase,
  pdl, graph, corporate, stripe, face, telegram).

Seul l'archivage `POST /api/gateway/email/complete` est reproduit, car il fait partie de la
séquence normale du scan email.

## Implémentation MASINT

Fichiers : `src/main/modules/roso/`.

| Fichier | Rôle |
|---|---|
| `_client.ts` | `RosoClient` : base URL, `X-API-Key`, `Origin`/`Referer`, `X-Session-Id`, réessais limités (erreur réseau, 500/502/503/504/520-524 ; jamais sur une route qui débite), traduction des erreurs en `ModuleError`, maintenance, `status()`, `pool()` à concurrence bornée, `redact()` qui retire la clé de `raw` |
| `_parse.ts` | lecture tolérante : profils → `account` (+ `person`, `email`, `phone`), fuites → `breach`, Hudson Rock → `infostealer`, IntelX, adresses, correspondance plateformes roso → `platforms.ts`, images (URL relatives rendues absolues, `eyecon-app.com` via le proxy public), repli générique (emails, téléphones, URL, pseudos) |
| `_sites.ts` | instantané généré des listes du site (907 sites pseudo, 57 plateformes téléphone, modules crypto de repli, noms affichés, instances Mastodon) |

| Module | Entrée | Appels | Sorties principales |
|---|---|---|---|
| `roso.email` | `email` | maintenance, start, meta, ~300 modules (12 en parallèle), complete | `account` par plateforme (avatar, URL, bio, dates), `person`, `email`, `phone`, `breach` (HIBP, IntelX), `infostealer`, `domain` (reverse WHOIS) ; `roso_credits_left`, `roso_found_count`, `roso_found_on`, `breaches` |
| `roso.username` | `username` | maintenance, start, 907 vérifications (20 en parallèle) ; la liste est relue sur `/username/` (cache 12 h) avec repli sur l'instantané | `account`, `person`, `email` (commits GitHub), `infostealer`, `url` (archives Wayback) |
| `roso.phone` | `phone` sans `*` | maintenance, phone/log, autochecks par lots de 3, HLR Twilio, FunStat | `account`, `person` (caller ID), `address` (annuaires), `carrier`, `infostealer`, `domain` ; `carrier`, `line_type`, `hlr_status` |
| `roso.ip` | `ip` | maintenance, start, lookup, 13 sources | `asn`, `country`, `hosting`, `organization`, `domain` (PTR, DNS passif) ; géolocalisation `lat`/`lon`, drapeaux VPN/Tor, `roso_<source>` |
| `roso.domain` | `domain` | maintenance, start, 11 routes | `website` (capture d'écran jointe, localisation du serveur), `domain` (sous-domaines), `ip`, `email`, `person`/`organization`/`phone` (RDAP, historique WHOIS), `breach` (IntelX) ; registrar, dates, serveurs DNS, statistiques Hudson Rock, VirusTotal, urlscan, OTX |
| `roso.name` | `person` | maintenance, name/search | `account` (profils candidats), `person` (homonymes), `email`, `phone` |
| `roso.partial_number` | `phone` ou `keyword` contenant `*` | start (10 crédits), 10 ou 100 checks à 2,5 s | `phone` candidats + `person` (caller ID) |
| `roso.crypto` | `crypto_wallet`, `crypto_tx` | maintenance, meta, ~140 modules | solde, transactions, étiquettes ; `account` (OpenSea...), `domain` (ENS), `organization` (propriétaire étiqueté), `breach`, `infostealer` |
| `roso.iban` | `iban` | maintenance, iban/check | `bank`, `address`, `country` ; `valid`, `bic`, `sepa`, `checks` |

Conventions : tous `ondemand`, `category: 'roso'`, clé `roso`, `homepage: https://roso.info`,
`experimental`. Un compte sur une plateforme absente de `platforms.ts` est libellé
`pseudo (Site)` pour ne pas fusionner des comptes homonymes de sites différents. `raw` contient
la réponse de lancement, les réponses des modules trouvés, la liste des erreurs, sans la clé.
Une erreur 401 en cours de scan arrête tout ; les autres erreurs de sous-module sont comptées
(`roso_errors`) sans interrompre le scan.

Tests : `tests/modules/roso.test.ts` (hors ligne, fixtures `tests/fixtures/roso/*.json`
construites d'après le code client) et `tests/modules/rosoLive.test.ts`
(`ROSO_KEY=roso_… npx vitest run tests/modules/rosoLive` : statut de la clé et maintenance,
gratuits ; ajouter `ROSO_LIVE_SPEND=1` pour une vérification IBAN à 1 crédit).

## À valider

Avec une vraie clé, vérifier en priorité :

1. le format exact de `/api/auth/status` (`credits` ou `credits_remaining`, `tier`) ;
2. `email/start` : présence de `sessionId`, `allowedModules`, `tier` ; contenu de `/api/ec/email/meta` ;
3. le champ porteur du profil dans les réponses email (`profile` attendu, `data` en repli) ;
4. `username/start` : forme de la réponse et coût réel ; comportement des `/api/uc/*` sans
   `/start` préalable ;
5. `phone/log` : réponse, coût, et si `autocheck` exige bien cette session (`phone_session_required`) ;
6. les formats `fields`/`records` des sources `/api/ip-preprod/lookup/*` ;
7. les enveloppes `result` des routes domaine et la taille de la capture CTI ;
8. la réponse de `name/search` et de `partial-number/check` ;
9. le coût réel du scan crypto (aucune route `/start` appelée par la page) ;
10. si les 900 vérifications pseudo à 20 en parallèle restent dans les limites tolérées.
