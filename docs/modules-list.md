# Liste des modules

<!-- Fichier généré : ne pas modifier à la main. -->
<!-- Régénérer avec : node build/scripts/list-modules.mjs > docs/modules-list.md -->

158 modules en 17 catégories, extraits du code source de `src/main/modules/`. Le guide pour écrire un module est dans [modules.md](modules.md).

Légende des remarques : **à la demande** (lancé seulement sur demande explicite, service à crédits), **bruyant** (peut alerter la personne recherchée), **expérimental** (résultats à vérifier). Une clé suivie de « (facultative) » améliore les résultats sans être obligatoire.

| Catégorie | Modules |
| --- | ---: |
| [Téléphone](#phone) | 9 |
| [Email](#email) | 26 |
| [Pseudo](#username) | 2 |
| [Personne](#person) | 11 |
| [Domaine](#domain) | 14 |
| [Adresse IP](#ip) | 13 |
| [Site web](#web) | 5 |
| [Crypto](#crypto) | 11 |
| [Finance](#finance) | 2 |
| [Entreprise](#company) | 12 |
| [Localisation](#location) | 3 |
| [Image](#image) | 3 |
| [Messagerie](#messaging) | 2 |
| [Réseaux sociaux](#social) | 28 |
| [Forensic / IOC](#forensic) | 6 |
| [Divers](#misc) | 2 |
| [roso.info](#roso) | 9 |

<a id="phone"></a>

## Téléphone (`phone`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `phone.amazon` | Compte Amazon | `phone` |  |  |
| `phone.arcep` | Opérateur d'attribution (ARCEP) | `phone` |  |  |
| `phone.hlr_lookups` | Statut HLR (HLR Lookups) | `phone` | `hlr-lookups`, `hlr-lookups-secret` | à la demande, expérimental |
| `phone.hlrlookup` | Statut HLR (HLR Lookup) | `phone` | `hlrlookup`, `hlrlookup-secret` | à la demande, expérimental |
| `phone.info` | Analyse du numéro | `phone` |  |  |
| `phone.leakcheck` | Fuites de données (LeakCheck) | `phone` |  | expérimental |
| `phone.links` | Signalements et recherches manuelles (téléphone) | `phone` |  |  |
| `phone.microsoft` | Compte Microsoft personnel | `phone` |  |  |
| `phone.sleeper` | Compte Sleeper | `phone` |  | expérimental |

<a id="email"></a>

## Email (`email`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `email.adobe` | Compte Adobe | `email` |  |  |
| `email.amazon` | Compte Amazon | `email` |  |  |
| `email.chesscom` | Compte Chess.com | `email` |  |  |
| `email.deezer` | Compte Deezer | `email` |  |  |
| `email.duolingo` | Compte Duolingo | `email` |  |  |
| `email.emailrep` | Réputation (EmailRep) | `email` | `emailrep` | expérimental |
| `email.eventbrite` | Compte Eventbrite | `email` |  |  |
| `email.freelancer` | Compte Freelancer | `email` |  |  |
| `email.github` | Commits GitHub | `email` | `github` (facultative) | expérimental |
| `email.gravatar` | Profil Gravatar | `email` |  |  |
| `email.hibp` | Have I Been Pwned | `email` | `hibp` |  |
| `email.hudsonrock` | Infostealers (Hudson Rock) | `email` |  |  |
| `email.info` | Analyse de l'adresse | `email` |  |  |
| `email.lastpass` | Compte LastPass | `email` |  |  |
| `email.leakcheck` | Fuites de données (LeakCheck) | `email` |  |  |
| `email.links` | Recherches manuelles (email) | `email` |  |  |
| `email.mailru` | Boîte Mail.ru existante | `email` |  |  |
| `email.microsoft` | Compte Microsoft personnel | `email` |  |  |
| `email.office365` | Compte Microsoft 365 (pro) | `email` |  |  |
| `email.snapchat` | Compte Snapchat / Bitmoji | `email` |  |  |
| `email.spotify` | Compte Spotify | `email` |  |  |
| `email.twitter` | Compte X (Twitter) | `email` |  |  |
| `email.wordpress` | Compte WordPress.com | `email` |  |  |
| `email.xposedornot` | Fuites de données (XposedOrNot) | `email` |  |  |
| `hints.crossmatch` | Recoupement des indices masqués | `*` |  |  |
| `hints.recovery` | Indices de récupération masqués | `email`, `phone` |  | à la demande, bruyant, expérimental |

<a id="username"></a>

## Pseudo (`username`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `username.sites` | Pseudo sur des centaines de sites | `username` |  |  |
| `username.sites_nsfw` | Pseudo sur les sites adultes | `username` |  | à la demande |

<a id="person"></a>

## Personne (`person`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `person.avocats` | Avocat (annuaire du CNB) | `person` |  |  |
| `person.bodacc` | Annonces BODACC (France) | `person` |  |  |
| `person.fr_deces` | Décès en France (INSEE) | `person` |  |  |
| `person.fr_dirigeants` | Mandats de dirigeant (France) | `person` |  |  |
| `person.jorf` | Journal officiel (France) | `person` |  |  |
| `person.rne_elus` | Répertoire national des élus | `person` |  |  |
| `person.rpps` | Professionnel de santé (RPPS) | `person`, `id_document` |  |  |
| `person.search_links` | Recherches manuelles (personne) | `person` |  |  |
| `person.transparence_sante` | Liens avec l’industrie (Transparence Santé) | `person`, `id_document` |  |  |
| `person.usernames` | Pseudos possibles (vérifiés) | `person` |  |  |
| `person.wikidata` | Wikidata (personnalité publique) | `person` |  | expérimental |

<a id="domain"></a>

## Domaine (`domain`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `certificate.crtsh` | Détails du certificat (crt.sh) | `certificate` |  | expérimental |
| `domain.certificates` | Certificats TLS | `domain`, `website` |  |  |
| `domain.dns` | Enregistrements DNS | `domain` |  |  |
| `domain.hosting` | Hébergeur et fournisseur DNS | `domain` |  |  |
| `domain.hudsonrock` | Infostealers (Hudson Rock) | `domain` |  |  |
| `domain.otx` | AlienVault OTX (domaine) | `domain` | `otx` (facultative) |  |
| `domain.securitytrails` | SecurityTrails | `domain` | `securitytrails` | à la demande, expérimental |
| `domain.shodan` | Shodan (DNS du domaine) | `domain` | `shodan` | à la demande, expérimental |
| `domain.subdomains` | Sous-domaines | `domain` |  |  |
| `domain.typosquat` | Domaines similaires (typosquatting) | `domain` |  | à la demande |
| `domain.urlscan` | URLScan.io | `domain`, `ip` | `urlscan` (facultative) |  |
| `domain.virustotal` | VirusTotal (domaine) | `domain` | `virustotal` | expérimental |
| `domain.wayback` | Historique Wayback Machine | `domain`, `url`, `website` |  | expérimental |
| `domain.whois` | WHOIS (RDAP) | `domain` |  |  |

<a id="ip"></a>

## Adresse IP (`ip`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `asn.info` | Informations ASN (RIPEstat) | `asn` |  |  |
| `cidr.info` | Informations sur la plage IP | `cidr` |  |  |
| `ip.abuseipdb` | AbuseIPDB | `ip` | `abuseipdb` | expérimental |
| `ip.geo` | Géolocalisation IP | `ip` |  |  |
| `ip.greynoise` | GreyNoise | `ip` | `greynoise` (facultative) |  |
| `ip.internetdb` | Shodan InternetDB | `ip` |  |  |
| `ip.otx` | AlienVault OTX (IP) | `ip` | `otx` (facultative) |  |
| `ip.reverse_dns` | DNS inverse (PTR) | `ip` |  |  |
| `ip.reverse_ip` | Domaines sur la même IP | `ip` |  |  |
| `ip.ripestat` | ASN, préfixe et contact abus (RIPEstat) | `ip` |  |  |
| `ip.shodan` | Shodan (hôte) | `ip` | `shodan` | expérimental |
| `ip.tor` | Nœud Tor | `ip` |  |  |
| `ip.virustotal` | VirusTotal (IP) | `ip` | `virustotal` | expérimental |

<a id="web"></a>

## Site web (`web`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `tracker.lookup` | Recherche inversée du traceur | `tracker` |  |  |
| `web.favicon` | Empreinte du favicon | `url`, `website`, `domain` | `urlscan` (facultative) | bruyant |
| `web.page` | Analyse de la page web | `url`, `website` |  | bruyant |
| `web.robots` | robots.txt et security.txt | `url`, `website`, `domain` |  | bruyant |
| `web.virustotal` | VirusTotal (URL) | `url`, `website` | `virustotal` | expérimental |

<a id="crypto"></a>

## Crypto (`crypto`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `crypto.bitcoin` | Portefeuille Bitcoin (mempool.space) | `crypto_wallet` |  |  |
| `crypto.bitcoincash` | Portefeuille Bitcoin Cash (Haskoin) | `crypto_wallet` |  |  |
| `crypto.dash` | Portefeuille Dash (BlockCypher) | `crypto_wallet` | `blockcypher` (facultative) |  |
| `crypto.dogecoin` | Portefeuille Dogecoin (BlockCypher) | `crypto_wallet` | `blockcypher` (facultative) |  |
| `crypto.ethereum` | Portefeuille Ethereum (Blockscout) | `crypto_wallet` |  |  |
| `crypto.evm_balances` | Soldes multi-chaînes EVM | `crypto_wallet` |  |  |
| `crypto.info` | Analyse de l'adresse crypto | `crypto_wallet` |  |  |
| `crypto.litecoin` | Portefeuille Litecoin (litecoinspace.org) | `crypto_wallet` |  |  |
| `crypto.ofac` | Sanctions OFAC (adresses crypto) | `crypto_wallet` |  |  |
| `crypto.solana` | Portefeuille Solana (RPC public) | `crypto_wallet` |  |  |
| `crypto.tron` | Portefeuille TRON (Tronscan) | `crypto_wallet` |  |  |

<a id="finance"></a>

## Finance (`finance`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `finance.iban` | Analyse de l'IBAN | `iban` |  |  |
| `finance.openiban` | Banque et BIC (OpenIBAN) | `iban` |  |  |

<a id="company"></a>

## Entreprise (`company`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `company.aides` | Aides de minimis | `company` |  |  |
| `company.avocats` | Cabinet d'avocats (annuaire du CNB) | `company` |  |  |
| `company.avocats_liste` | Avocats d'un cabinet (liste) | `company` |  | à la demande |
| `company.boamp` | Avis d'attribution (BOAMP) | `company` |  |  |
| `company.companies_house` | Société britannique (Companies House) | `company` | `companies_house` | expérimental |
| `company.fr_registry` | Entreprise française (annuaire officiel) | `company` |  |  |
| `company.icpe` | Installations classées (Géorisques) | `company` |  |  |
| `company.marches_publics` | Marchés publics (DECP) | `company` |  |  |
| `company.opencorporates` | Registres mondiaux (OpenCorporates) | `company` | `opencorporates` | expérimental |
| `company.ted` | Marchés européens (TED) | `company` |  |  |
| `company.transparence_sante` | Versements aux professionnels de santé (Transparence Santé) | `company` |  |  |
| `company.vies` | TVA intracommunautaire (VIES) | `vat` |  |  |

<a id="location"></a>

## Localisation (`location`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `location.geocode` | Géocodage (BAN / OpenStreetMap) | `address`, `city`, `place` |  |  |
| `location.map_links` | Liens cartographiques | `address`, `city`, `place`, `coordinates` |  |  |
| `location.reverse` | Géocodage inverse | `coordinates` |  |  |

<a id="image"></a>

## Image (`image`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `image.exif` | Métadonnées de la photo (EXIF) | `photo` |  |  |
| `image.hashes` | Empreintes du fichier image | `photo` |  |  |
| `image.reverse_search` | Recherche d'image inversée | `photo` |  | expérimental |

<a id="messaging"></a>

## Messagerie (`messaging`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `messaging.discord_invite` | Invitation Discord | `url`, `keyword` |  |  |
| `messaging.telegram` | Telegram (page publique) | `username`, `account` |  |  |

<a id="social"></a>

## Réseaux sociaux (`social`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `social.bluesky` | Profil Bluesky | `username`, `account` |  |  |
| `social.chesscom` | Profil Chess.com | `username`, `account` |  |  |
| `social.codeberg` | Profil Codeberg | `username`, `account` |  |  |
| `social.devto` | Profil DEV | `username`, `account` |  |  |
| `social.dockerhub` | Profil Docker Hub | `username`, `account` |  |  |
| `social.duolingo` | Profil Duolingo | `username`, `account` |  |  |
| `social.github` | Profil GitHub | `username`, `account` | `github` (facultative) | expérimental |
| `social.gitlab` | Profil GitLab | `username`, `account` |  |  |
| `social.gravatar` | Profil Gravatar | `username`, `account` |  |  |
| `social.hackernews` | Profil Hacker News | `username`, `account` |  |  |
| `social.huggingface` | Profil Hugging Face | `username`, `account` |  |  |
| `social.keybase` | Profil Keybase | `username`, `account` |  |  |
| `social.kick` | Chaîne Kick | `username`, `account` |  | expérimental |
| `social.lichess` | Profil Lichess | `username`, `account` |  |  |
| `social.linktree` | Page Linktree | `username`, `account` |  |  |
| `social.mastodon` | Comptes Mastodon | `username`, `account` |  |  |
| `social.minecraft` | Compte Minecraft | `username`, `account` |  |  |
| `social.npm` | Compte npm | `username`, `account` |  |  |
| `social.reddit` | Profil Reddit | `username`, `account` |  | expérimental |
| `social.roblox` | Profil Roblox | `username`, `account` |  |  |
| `social.snapchat` | Profil Snapchat | `username`, `account` |  |  |
| `social.steam` | Profil Steam | `username`, `account` |  |  |
| `social.strava` | Athlète Strava | `username`, `account` |  |  |
| `social.tiktok` | Profil TikTok | `username`, `account` |  |  |
| `social.twitch` | Chaîne Twitch | `username`, `account` |  |  |
| `social.wikimedia` | Compte Wikipédia / Wikimedia | `username`, `account` |  |  |
| `social.x` | Profil X (Twitter) | `username`, `account` |  |  |
| `social.youtube` | Chaîne YouTube | `username`, `account` |  |  |

<a id="forensic"></a>

## Forensic / IOC (`forensic`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `forensic.cve` | Vulnérabilité CVE | `cve` |  |  |
| `forensic.hashlookup` | Fichier connu (CIRCL hashlookup) | `hash` |  |  |
| `forensic.hibp_breach` | Détails de la fuite (Have I Been Pwned) | `breach` |  |  |
| `forensic.malwarebazaar` | Échantillon de malware (MalwareBazaar) | `hash` | `abusech` | expérimental |
| `forensic.virustotal` | Réputation du fichier (VirusTotal) | `hash` | `virustotal` | expérimental |
| `misc.user_agent` | Analyse du User-Agent | `user_agent` |  |  |

<a id="misc"></a>

## Divers (`misc`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `misc.license_plate` | Analyse de la plaque d'immatriculation | `license_plate` |  |  |
| `misc.mac_vendor` | Constructeur de l'adresse MAC | `mac_address` |  |  |

<a id="roso"></a>

## roso.info (`roso`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `roso.crypto` | roso.info : crypto | `crypto_wallet`, `crypto_tx` | `roso` | à la demande, expérimental |
| `roso.domain` | roso.info : domaine | `domain` | `roso` | à la demande, expérimental |
| `roso.email` | roso.info : email | `email` | `roso` | à la demande, expérimental |
| `roso.iban` | roso.info : IBAN | `iban` | `roso` | à la demande, expérimental |
| `roso.ip` | roso.info : adresse IP | `ip` | `roso` | à la demande, expérimental |
| `roso.name` | roso.info : nom et prénom | `person` | `roso` | à la demande, expérimental |
| `roso.partial_number` | roso.info : numéro partiel | `phone`, `keyword` | `roso` | à la demande, expérimental |
| `roso.phone` | roso.info : téléphone | `phone` | `roso` | à la demande, expérimental |
| `roso.username` | roso.info : pseudo (~900 sites) | `username` | `roso` | à la demande, expérimental |
