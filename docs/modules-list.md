# Liste des modules

<!-- Fichier généré : ne pas modifier à la main. -->
<!-- Régénérer avec : node build/scripts/list-modules.mjs > docs/modules-list.md -->

209 modules en 17 catégories, extraits du code source de `src/main/modules/`. Le guide pour écrire un module est dans [modules.md](modules.md).

Légende des remarques : **à la demande** (lancé seulement sur demande explicite, service à crédits), **bruyant** (peut alerter la personne recherchée), **expérimental** (résultats à vérifier). Une clé suivie de « (facultative) » améliore les résultats sans être obligatoire.

| Catégorie | Modules |
| --- | ---: |
| [Téléphone](#phone) | 10 |
| [Email](#email) | 39 |
| [Pseudo](#username) | 3 |
| [Personne](#person) | 13 |
| [Domaine](#domain) | 17 |
| [Adresse IP](#ip) | 14 |
| [Site web](#web) | 8 |
| [Crypto](#crypto) | 14 |
| [Finance](#finance) | 4 |
| [Entreprise](#company) | 23 |
| [Localisation](#location) | 5 |
| [Image](#image) | 4 |
| [Messagerie](#messaging) | 2 |
| [Réseaux sociaux](#social) | 32 |
| [Forensic / IOC](#forensic) | 8 |
| [Divers](#misc) | 4 |
| [roso.info](#roso) | 9 |

<a id="phone"></a>

## Téléphone (`phone`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `phone.amazon` | Compte Amazon | `phone` |  |  |
| `phone.arcep` | Opérateur d'attribution (ARCEP) | `phone` |  |  |
| `phone.caller_names` | Nom donné au numéro (annuaires d’appelants) | `account`, `phone` |  |  |
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
| `email.anydo` | Compte Any.do | `email` |  |  |
| `email.chesscom` | Compte Chess.com | `email` |  |  |
| `email.codecademy` | Compte Codecademy | `email` |  |  |
| `email.deezer` | Compte Deezer | `email` |  |  |
| `email.diigo` | Compte Diigo | `email` |  |  |
| `email.duolingo` | Compte Duolingo | `email` |  |  |
| `email.emailrep` | Réputation (EmailRep) | `email` | `emailrep` | expérimental |
| `email.eventbrite` | Compte Eventbrite | `email` |  |  |
| `email.firefox` | Compte Mozilla (Firefox) | `email` |  |  |
| `email.flickr` | Compte Flickr | `email` |  |  |
| `email.freelancer` | Compte Freelancer | `email` |  |  |
| `email.github` | Commits GitHub | `email` | `github` (facultative) | expérimental |
| `email.google_calendar` | Agenda Google public | `email` |  |  |
| `email.gravatar` | Profil Gravatar | `email` |  |  |
| `email.hibp` | Have I Been Pwned | `email` | `hibp` |  |
| `email.hudsonrock` | Infostealers (Hudson Rock) | `email` |  |  |
| `email.info` | Analyse de l'adresse | `email` |  |  |
| `email.insightly` | Compte Insightly | `email` |  |  |
| `email.lastpass` | Compte LastPass | `email` |  |  |
| `email.leakcheck` | Fuites de données (LeakCheck) | `email` |  |  |
| `email.links` | Recherches manuelles (email) | `email` |  |  |
| `email.mailru` | Boîte Mail.ru existante | `email` |  |  |
| `email.microsoft` | Compte Microsoft personnel | `email` |  |  |
| `email.myspace` | Compte Myspace | `email` |  |  |
| `email.office365` | Compte Microsoft 365 (pro) | `email` |  |  |
| `email.pgp` | Clés PGP publiques | `email` |  |  |
| `email.plurk` | Compte Plurk | `email` |  |  |
| `email.proton` | Adresse hébergée chez Proton | `email` |  | expérimental |
| `email.rambler` | Compte Rambler | `email` |  |  |
| `email.snapchat` | Compte Snapchat / Bitmoji | `email` |  |  |
| `email.spotify` | Compte Spotify | `email` |  |  |
| `email.twitter` | Compte X (Twitter) | `email` |  |  |
| `email.wordpress` | Compte WordPress.com | `email` |  |  |
| `email.xposedornot` | Fuites de données (XposedOrNot) | `email` |  |  |
| `email.xvideos` | Compte XVideos (adulte) | `email` |  | à la demande |
| `hints.crossmatch` | Recoupement des indices masqués | `*` |  |  |
| `hints.recovery` | Indices de récupération masqués | `email`, `phone` |  | à la demande, bruyant, expérimental |

<a id="username"></a>

## Pseudo (`username`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `username.sites` | Pseudo sur des centaines de sites | `username` |  |  |
| `username.sites_extended` | Pseudo sur des milliers de sites | `username` |  | à la demande |
| `username.sites_nsfw` | Pseudo sur les sites adultes | `username` |  | à la demande |

<a id="person"></a>

## Personne (`person`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `person.avocats` | Avocat (annuaire du CNB) | `person` |  |  |
| `person.bodacc` | Annonces BODACC (France) | `person` |  |  |
| `person.fr_deces` | Décès en France (INSEE) | `person` |  |  |
| `person.fr_dirigeants` | Mandats de dirigeant (France) | `person` |  |  |
| `person.fr_elus` | Mandats d’élu local (France) | `person` |  |  |
| `person.hatvp` | Déclarations à la HATVP | `person` |  | expérimental |
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
| `domain.m365` | Tenant Microsoft 365 | `domain` |  |  |
| `domain.otx` | AlienVault OTX (domaine) | `domain` | `otx` (facultative) |  |
| `domain.pdns` | Historique DNS (Mnemonic) | `domain`, `ip` |  |  |
| `domain.pgp` | Clés PGP du domaine | `domain` |  |  |
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
| `ip.blocklists` | Listes de blocage publiques | `ip` |  |  |
| `ip.geo` | Géolocalisation IP | `ip` |  |  |
| `ip.greynoise` | GreyNoise | `ip` | `greynoise` (facultative) |  |
| `ip.internetdb` | Shodan InternetDB | `ip` |  |  |
| `ip.otx` | AlienVault OTX (IP) | `ip` | `otx` (facultative) |  |
| `ip.reverse_dns` | DNS inverse (PTR) | `ip` |  |  |
| `ip.reverse_ip` | Domaines sur la même IP | `ip` |  |  |
| `ip.ripestat` | ASN, préfixe et titulaire (RIPEstat) | `ip` |  |  |
| `ip.shodan` | Shodan (hôte) | `ip` | `shodan` | expérimental |
| `ip.tor` | Nœud Tor | `ip` |  |  |
| `ip.virustotal` | VirusTotal (IP) | `ip` | `virustotal` | expérimental |

<a id="web"></a>

## Site web (`web`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `misc.url_parse` | Lecture de l'URL | `url`, `website` |  |  |
| `tracker.gtm` | Contenu du conteneur Google Tag Manager | `tracker` |  |  |
| `tracker.lookup` | Recherche inversée du traceur | `tracker` |  |  |
| `web.favicon` | Empreinte du favicon | `url`, `website`, `domain` | `urlscan` (facultative) | bruyant |
| `web.page` | Analyse de la page web | `url`, `website` |  | bruyant |
| `web.robots` | robots.txt, security.txt et plan du site | `url`, `website`, `domain` |  | bruyant |
| `web.virustotal` | VirusTotal (URL) | `url`, `website` | `virustotal` | expérimental |
| `web.wellknown` | ads.txt et applications mobiles liées | `url`, `website`, `domain` |  | bruyant |

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
| `crypto.ton` | Portefeuille TON (toncenter) | `crypto_wallet` |  |  |
| `crypto.transaction` | Transaction crypto (explorateurs publics) | `crypto_tx` |  |  |
| `crypto.tron` | Portefeuille TRON (Tronscan) | `crypto_wallet` |  |  |
| `crypto.walletexplorer` | Regroupement d’adresses Bitcoin (WalletExplorer) | `crypto_wallet` |  |  |

<a id="finance"></a>

## Finance (`finance`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `finance.amf_blacklist` | Listes noires de l’AMF | `domain`, `website`, `email`, `company`, `organization` |  |  |
| `finance.iban` | Analyse de l'IBAN | `iban` |  |  |
| `finance.openiban` | Banque et BIC (OpenIBAN) | `iban` |  |  |
| `finance.sanctions` | Sanctions et gel des avoirs (France, UE, OFAC) | `person`, `company`, `organization`, `email`, `phone`, `domain`, `website`, `crypto_wallet` |  |  |

<a id="company"></a>

## Entreprise (`company`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `administration.annuaire` | Annuaire de l'administration (Service-Public.fr) | `administration`, `organization` |  |  |
| `company.aides` | Aides de minimis | `company` |  |  |
| `company.ares` | Entreprise tchèque (ARES) | `company` |  |  |
| `company.avocats` | Cabinet d'avocats (annuaire du CNB) | `company` |  |  |
| `company.avocats_liste` | Avocats d'un cabinet (liste) | `company` |  | à la demande |
| `company.boamp` | Avis d'attribution (BOAMP) | `company` |  |  |
| `company.bodacc` | Annonces BODACC et BALO (entreprise) | `company`, `organization` |  |  |
| `company.brreg` | Entreprise norvégienne (Brønnøysund) | `company` |  |  |
| `company.companies_house` | Société britannique (Companies House) | `company` | `companies_house` | expérimental |
| `company.cro` | Entreprise irlandaise (CRO) | `company` |  |  |
| `company.fr_registry` | Entreprise française (annuaire officiel) | `company` |  |  |
| `company.gleif` | LEI et liens de groupe (GLEIF) | `company`, `organization` |  |  |
| `company.hatvp_lobbying` | Représentant d’intérêts (HATVP) | `company`, `organization` |  | expérimental |
| `company.icpe` | Installations classées (Géorisques) | `company` |  |  |
| `company.jo_associations` | Journal officiel des associations | `organization`, `company` |  |  |
| `company.marches_publics` | Marchés publics (DECP) | `company` |  |  |
| `company.opencorporates` | Registres mondiaux (OpenCorporates) | `company` | `opencorporates` | expérimental |
| `company.prh` | Entreprise finlandaise (PRH / YTJ) | `company` |  |  |
| `company.sitadel` | Permis de construire de l'entreprise (Sitadel) | `company` |  |  |
| `company.ted` | Marchés européens (TED) | `company` |  |  |
| `company.transparence_sante` | Versements aux professionnels de santé (Transparence Santé) | `company` |  |  |
| `company.vies` | TVA intracommunautaire (VIES) | `vat` |  |  |
| `company.wikidata` | Wikidata (organisation) | `company`, `organization` |  | expérimental |

<a id="location"></a>

## Localisation (`location`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `location.entreprises_adresse` | Entreprises à une adresse (SIRENE) | `address`, `coordinates` |  |  |
| `location.geocode` | Géocodage (BAN / OpenStreetMap) | `address`, `city`, `place` |  |  |
| `location.immobilier` | Immobilier (cadastre, DVF, DPE, permis) | `address`, `coordinates` |  |  |
| `location.map_links` | Liens cartographiques | `address`, `city`, `place`, `coordinates` |  |  |
| `location.reverse` | Géocodage inverse | `coordinates` |  |  |

<a id="image"></a>

## Image (`image`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `image.exif` | Métadonnées de la photo (EXIF) | `photo` |  |  |
| `image.hashes` | Empreintes du fichier image | `photo` |  |  |
| `image.reverse_search` | Recherche d'image inversée | `photo` |  | expérimental |
| `social.avatar_photo` | Photo de profil | `account` |  |  |

<a id="messaging"></a>

## Messagerie (`messaging`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `messaging.discord_invite` | Invitation Discord | `url`, `keyword` |  |  |
| `messaging.telegram` | Telegram (page publique) | `username`, `account`, `group` |  |  |

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
| `social.kick` | Chaîne Kick | `username`, `account` |  |  |
| `social.lichess` | Profil Lichess | `username`, `account` |  |  |
| `social.linkinbio` | Page « lien en bio » | `url`, `website`, `account` |  |  |
| `social.linktree` | Page Linktree | `username`, `account` |  |  |
| `social.mastodon` | Comptes Mastodon | `username`, `account` |  |  |
| `social.minecraft` | Compte Minecraft | `username`, `account` |  |  |
| `social.npm` | Compte npm | `username`, `account` |  |  |
| `social.profile_manual` | Profil à consulter | `account` |  |  |
| `social.reddit` | Profil Reddit | `username`, `account` |  | expérimental |
| `social.roblox` | Profil Roblox | `username`, `account` |  |  |
| `social.snapchat` | Profil Snapchat | `username`, `account` |  |  |
| `social.steam` | Profil Steam | `username`, `account` |  |  |
| `social.strava` | Athlète Strava | `username`, `account` |  |  |
| `social.threads` | Profil Threads (et Instagram) | `username`, `account` |  | expérimental |
| `social.tiktok` | Profil TikTok | `username`, `account` |  |  |
| `social.twitch` | Chaîne Twitch | `username`, `account` |  |  |
| `social.wikimedia` | Compte Wikipédia / Wikimedia | `username`, `account` |  |  |
| `social.x` | Profil X (Twitter) | `username`, `account` |  |  |
| `social.x_history` | Historique des pseudos X (memory.lol) | `username`, `account` |  |  |
| `social.youtube` | Chaîne YouTube | `username`, `account` |  |  |

<a id="forensic"></a>

## Forensic / IOC (`forensic`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `forensic.cve` | Vulnérabilité CVE | `cve` |  |  |
| `forensic.hashlookup` | Fichier connu (CIRCL hashlookup) | `hash` |  |  |
| `forensic.hibp_breach` | Détails de la fuite (Have I Been Pwned) | `breach` |  |  |
| `forensic.malwarebazaar` | Échantillon de malware (MalwareBazaar) | `hash` | `abusech` | expérimental |
| `forensic.threatfox` | Indicateurs de compromission (ThreatFox) | `domain`, `ip`, `url`, `hash` | `abusech` | expérimental |
| `forensic.urlhaus` | URL malveillantes (URLhaus) | `domain`, `ip` | `abusech` | expérimental |
| `forensic.virustotal` | Réputation du fichier (VirusTotal) | `hash` | `virustotal` | expérimental |
| `misc.user_agent` | Analyse du User-Agent | `user_agent` |  |  |

<a id="misc"></a>

## Divers (`misc`)

| Identifiant | Nom | Entrées | Clés API | Remarques |
| --- | --- | --- | --- | --- |
| `misc.license_plate` | Analyse de la plaque d'immatriculation | `license_plate` |  |  |
| `misc.mac_vendor` | Constructeur de l'adresse MAC | `mac_address` |  |  |
| `misc.snowflake` | Date cachée dans l'identifiant | `account`, `group` |  |  |
| `vehicle.rdw` | Véhicule néerlandais (RDW) | `license_plate` |  |  |

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
