# Écrire un module d'enrichissement

Un module reçoit **une entité** du graphe (un email, un numéro, un pseudo, un domaine...) et
renvoie ce qu'il a trouvé : de **nouvelles entités** reliées à celle d'origine, des **liens**
entre elles et des **propriétés** fusionnées dans la fiche de l'entité d'origine.

Les modules s'exécutent dans le processus principal d'Electron. Ils ont accès au réseau, mais
uniquement à travers le contexte fourni (`ctx.fetch`), qui applique le proxy ou Tor choisi par
l'utilisateur, le User-Agent et les délais. Ils n'ont aucun accès à l'interface ni à la base :
c'est le moteur qui enregistre le résultat, dédoublonne les entités et place les nœuds.

Sommaire :

1. [Où placer le fichier](#où-placer-le-fichier)
2. [Anatomie d'un module](#anatomie-dun-module)
3. [Le contexte `ctx`](#le-contexte-ctx)
4. [Le résultat](#le-résultat)
5. [Conventions](#conventions)
6. [Exemple complet](#exemple-complet--wikidata)
7. [Tests](#tests)
8. [Avant d'ouvrir une pull request](#avant-douvrir-une-pull-request)
9. [Liste des modules](#liste-des-modules)

## Où placer le fichier

```
src/main/modules/
  email/
    _lib.ts          utilitaires partagés (ignorés par le registre)
    gravatar.ts      un module : export default defineModule({ ... })
    accounts.ts      plusieurs modules : export const modules = [ ... ]
  phone/
  ...
```

- Le registre (`src/main/engine/registry.ts`) découvre les modules **automatiquement** au
  build : tout fichier `src/main/modules/**/*.ts` qui exporte par défaut un module, un tableau
  de modules, ou un tableau nommé `modules`, est enregistré. Rien d'autre à déclarer.
- Les fichiers et dossiers dont le nom commence par `_` sont des utilitaires : ils ne sont pas
  parcourus par le registre.
- Rangez le fichier dans le dossier de sa famille (`email`, `phone`, `domain`, `ip`, `social`,
  `crypto`...). L'identifiant suit la forme `famille.nom` (`email.gravatar`, `ip.geo`) et doit
  être **unique** : en cas de doublon, le dernier chargé l'emporte et un avertissement est
  affiché dans la console.

## Anatomie d'un module

Le type `OsintModule` est défini dans `src/shared/modules.ts`. `defineModule()` ne fait rien
d'autre que vérifier le typage.

| Champ | Obligatoire | Rôle |
| --- | --- | --- |
| `id` | oui | Identifiant unique `famille.nom`. Ne pas le changer une fois publié : il sert à l'historique des exécutions et aux réglages. |
| `name` | oui | Nom court, en français et en anglais : `{ fr, en }`. |
| `description` | oui | Une ou deux phrases : ce que le module interroge et ce qu'il renvoie. `{ fr, en }`. |
| `category` | oui | Famille affichée dans la vue Modules (`ModuleCategory` dans `src/shared/types.ts`). |
| `inputTypes` | oui | Types d'entités acceptés (`'email'`, `'phone'`, `'username'`...). Voir `src/shared/entityTypes.ts`. `'*'` accepte tout. |
| `accepts(input)` | non | Filtre supplémentaire, par exemple n'accepter que les comptes d'une plateforme précise. |
| `keys` | non | Clés API nécessaires, voir [Clés API](#clés-api-keys). |
| `ondemand` | non | Ne se lance que sur demande explicite. Voir [À la demande](#à-la-demande-ondemand). |
| `noisy` | non | Peut alerter la personne recherchée. Voir [Bruyant](#bruyant-noisy). |
| `experimental` | non | Résultats à vérifier, service instable ou détection fragile. |
| `homepage` | non | Page du service interrogé, affichée dans la fiche du module. |
| `timeoutMs` | non | Durée maximale d'exécution si elle dépasse 3 minutes (limite par défaut). |
| `run(input, ctx)` | oui | La fonction qui fait le travail. Elle renvoie une `ModuleOutput`. |

L'entité reçue (`InputEntity`) contient `id`, `type`, `label` (la valeur : l'adresse, le
numéro...), `platform` (pour un compte : `github`, `x`...), `data` (les propriétés déjà
connues, éventuellement enrichies par un module précédent) et `imageId` / `imageOrigin` si une
image est jointe.

Un module est proposé pour un nœud quand son type figure dans `inputTypes`, que `accepts`
l'accepte, que ses clés obligatoires sont renseignées et qu'il n'est pas désactivé dans les
réglages. Lors d'un enrichissement global, les modules « à la demande » sont exclus.

## Le contexte `ctx`

| Membre | Description |
| --- | --- |
| `fetch(url, init)` | `fetch` standard passant par le proxy ou Tor configuré (et le routage par module), avec le User-Agent et le délai des réglages. Options en plus : `timeoutMs`, `json` (corps JSON), `query` (paramètres d'URL). |
| `fetchJson<T>(url, init)` | GET ou POST avec réponse JSON. Lève une `HttpError` (avec `status` et `body`) si le statut n'est pas 2xx. |
| `fetchText(url, init)` | Idem, réponse texte. |
| `resolveDns(nom, type)` | Résolution DNS par DNS-over-HTTPS, à travers le proxy : aucune fuite DNS locale, même sous Tor. |
| `key(id)` | Valeur d'une clé API du coffre (`undefined` si absente). |
| `attachment(id)` | Contenu d'une pièce jointe de l'enquête (photo à analyser). |
| `signal` | `AbortSignal` déclenché quand l'utilisateur annule ou que le délai expire. `ctx.fetch` l'utilise déjà ; passez-le à vos propres attentes (`setTimeout`...). |
| `lang` | `'fr'` ou `'en'` : langue de l'interface, pour les libellés de liens et de propriétés. |
| `userAgent` | User-Agent configuré. |
| `log(message)` | Trace dans la console du processus principal (préfixée par l'id du module). |
| `progress(fait, total, détail?)` | Avancement interne d'un module long (« 23/57 · WhatsApp »), affiché dans la pastille de progression. Appelez-le librement : le moteur espace les envois. |
| `egress` | Sortie réseau du module (`direct`, `tor` ou `proxy:<empreinte>`, jamais l'adresse elle-même) : clé des caches qui dépendent de l'adresse IP de sortie, comme l'état de santé des sites de pseudo. Absente dans les tests (équivaut à `direct`). |

N'utilisez jamais le `fetch` global, `node:dns` ou une bibliothèque HTTP directement : la
requête contournerait le proxy et Tor, et révélerait l'adresse IP de l'enquêteur.

## Le résultat

`run` renvoie une `ModuleOutput` :

```ts
{
  properties?: Record<string, PropValue>  // fusionnées dans l'entité d'origine
  entities?: OutEntity[]                   // nouvelles entités, liées à l'origine
  links?: OutLink[]                        // liens supplémentaires entre entités du résultat
  found?: boolean                          // vérification de compte : existe ou non
  raw?: unknown                            // réponse brute, archivée pour consultation
}
```

Une `OutEntity` décrit un nœud à créer :

| Champ | Rôle |
| --- | --- |
| `type`, `label` | Type d'entité et valeur affichée. Obligatoires. |
| `platform` | Plateforme (`x`, `github`, `orange`...) : identifiant de `src/shared/platforms.ts`. `findPlatformByName()` aide à le retrouver depuis un nom. Pour un email, le fournisseur est déduit automatiquement. |
| `data` | Propriétés de la nouvelle entité. |
| `image` | URL d'une image (avatar, photo, logo), voir [Images](#images-image). |
| `linkLabel` | Libellé du lien depuis le parent (« compte X », « MX », « lieu de naissance »). |
| `ref`, `from` | Pour chaîner : donnez une `ref` à une entité, puis `from: 'cette-ref'` à une autre pour la rattacher à la première plutôt qu'à l'entité d'origine (`$input`). |
| `strength` | Force du lien avec le parent : `same`, `declared`, `mention` ou `weak`. Elle décide de l'enchaînement automatique, voir [Force du lien](#force-du-lien--strength). |

Le moteur **dédoublonne** : une entité de même type, même plateforme et même valeur (comparée
sans casse, `www.`, `https://` ni `@`) est réutilisée au lieu d'être recréée ; ses nouvelles
propriétés sont fusionnées. Les valeurs vides (`null`, `''`, `[]`) sont ignorées.

Quand le module ne trouve rien, renvoyez simplement `{}` : ce n'est pas une erreur.

### Erreurs

Levez une `ModuleError(message, code)` quand le service répond mais refuse ou ne peut pas
répondre ; le message est affiché tel quel dans l'historique. Codes : `rate_limited` (quota),
`auth` (clé refusée), `blocked` (captcha, pare-feu), `unavailable` (service en panne),
`invalid_input` (valeur inexploitable), `other`. Toute autre exception est aussi enregistrée
comme une erreur, avec son message. Un dépassement de délai est signalé comme « Délai
dépassé ».

## Conventions

### Coordonnées : `lat` / `lon`

Une entité dont `data` contient `lat` et `lon` (nombres, en degrés décimaux WGS 84) apparaît
sur la **carte**. Utilisez exactement ces deux clés, pas `latitude` ni `lng`. Une précision
éventuelle va dans `accuracy` (mètres).

### Dates : la frise chronologique

Les propriétés dont la clé est reconnue comme une date alimentent la **frise** : clé `date`,
ou se terminant par `_date`, `_at`, `_seen`, `_since`, `_until`, `_time`, `_timestamp`,
`_born` (voir `isDateKey()` dans `src/shared/entityTypes.ts`). Exemples : `created_at`,
`birth_date`, `last_seen`, `breach_date`. Les valeurs sont des chaînes ISO 8601 :
`2024`, `2024-03`, `2024-03-15` ou `2024-03-15T10:20:00Z`. Ne mettez pas une date sous une autre
clé si vous voulez la voir sur la frise, et ne mettez pas autre chose qu'une date sous ces clés.

### Vérification de compte : `found`

Les modules qui répondent à la question « ce compte existe-t-il ? » (email inscrit sur un
service, pseudo pris...) renvoient `found: true` ou `found: false`. L'historique affiche alors
« trouvé » ou « absent ». Laissez `found` indéfini pour les autres modules. Quand le service ne
permet pas de conclure (captcha, réponse ambiguë), levez une `ModuleError` plutôt que de
répondre `false`.

### Résultats à vérifier : `review` et `manual`

Le graphe ne doit contenir que des résultats vérifiés. Deux mécanismes gardent le reste à part,
dans la liste « À vérifier » de la fiche, où l'enquêteur valide ou écarte chaque élément :

- `review: true` sur une entité (avec `reviewReason`, par exemple « homonyme possible » ou
  « pseudo généré, trouvé sur GitHub ») : hypothèse plausible mais non confirmée. Elle n'entre
  dans le graphe que si l'enquêteur la valide. Si la même entité existe déjà dans l'enquête,
  elle est reliée directement. Une suggestion écartée n'est plus proposée.
- `manual: [{ label, url, hint }]` : recherche que le module ne peut pas faire lui-même (compte
  requis, captcha, pas d'API). L'enquêteur la lance dans MASINT (« Chercher » : navigateur
  intégré, session persistante, proxy et Tor respectés ; la fenêtre ne s'affiche que pour un
  captcha ou une connexion) et ne garde que les résultats qui contiennent la valeur, ou ouvre
  la page lui-même, puis note « rien trouvé » ou ce qu'il a trouvé.
- `followUp: true` sur un module : il est relancé à la fin d'une tâche quand les résultats des
  autres modules le rendent applicable (ex. recoupement des indices masqués).

Avant de proposer une recherche manuelle, cherchez à l'automatiser : un lien de recherche que
l'enquêteur doit ouvrir lui-même n'apporte presque rien. Aucun module ne crée de nœud
`search_link`.

### Force du lien : `strength`

Quand l'enchaînement est actif (réglage « Enchaînement », avec l'enrichissement automatique ou
l'action « Enrichir en chaîne »), chaque **nouveau** nœud dont le lien est `same` ou
`declared` est enrichi à son tour, jusqu'à la profondeur réglée. Déclarez la force de chaque
entité quand elle ne découle pas de son type :

| Valeur | Sens | Exemples |
| --- | --- | --- |
| `same` | Même identité, établie par le service. | Preuve Keybase, compte vérifié Gravatar, comptes sociaux déclarés à GitHub, inscription vérifiée avec l'email, compte retrouvé par son identifiant, ancien pseudo du même compte. |
| `declared` | Déclaré par la personne elle-même. | Lien de bio, site du profil, panneaux Twitch, Linktree et pages « lien en bio », email public du profil. |
| `mention` | Simple mention. | URL ou email extrait d'un texte libre, email de commit d'un autre auteur, organisation, domaine de l'adresse. |
| `weak` | Rapprochement fragile. | Même pseudo sur un autre site (`username.sites`), pseudo ou adresse générés. |

Sans `strength`, la force dépend du type (`defaultStrength` dans
`src/main/engine/chain.ts`) : `declared` pour un compte, un email, un téléphone, un site ou une
URL ; `weak` pour un pseudo ; `mention` pour le reste (personne, organisation, adresse IP,
domaine...). L'enchaînement suit une identité, pas une infrastructure.

`linkedEntities()` (`social/_lib.ts`) annote déjà ses sorties : `urls` et `emails` sont
`declared`, ce qui est extrait de `text` est `mention`, `sameUrls` (comptes vérifiés par la
plateforme) est `same` ; `urlStrength` remplace la force des `urls`. `profileOutput()` marque
`same` le compte retrouvé à partir d'un pseudo.

Ce que l'enchaînement ne fait jamais :

- lancer un module `ondemand`, `noisy` ou à clé obligatoire (crédits, quotas) ;
- lancer `username.sites` ou `username.sites_extended` au-delà de la profondeur 1 ;
- lancer un module de la famille `web` sur un nœud `url` ;
- enrichir une adresse générique (`noreply@`, `support@github.com`...), un raccourcisseur
  d'URL, la page d'accueil d'une plateforme, un compte de plus de 100 000 abonnés (sauf le nœud
  de départ), un identifiant enrichi depuis moins de 24 heures, ou un pseudo trop courant (moins
  de 5 caractères, prénom courant, mot du dictionnaire).

Sur un nœud atteint par enchaînement, les nouvelles entités `mention` et `weak` vont dans
« À vérifier » avec le motif « trouvé via A puis B, profondeur N » ; les valider relance la
chaîne. Une tâche en chaîne s'arrête à 30 nouveaux nœuds par saut, 100 exécutions de modules
ou 10 minutes : le surplus va dans « À vérifier » avec le motif « budget atteint ».

### Provenance : observations

Le moteur consigne chaque élément vu par un module dans la table `observations` : l'entité, le
lien depuis son parent et chaque propriété écrite, avec l'exécution (`module_runs`), la date et
la page source. La page source est `source_url` de l'entité, sinon la page de l'entité à
laquelle elle est rattachée (`from`), sinon son `url` ; pour les propriétés de l'entrée,
`source_url` ou `url` des propriétés. Donnez `url` (ou `source_url`) quand le service en
fournit une : elle apparaît dans la section « Sources » de la fiche.

### Images : `image`

`image` accepte une URL `http(s)` ou une URI `data:image/...;base64,...`. Le moteur télécharge
l'image **à travers le proxy**, vérifie qu'il s'agit bien d'une image (type `image/*`, 4 Mo au
plus) et la joint au nœud. Une entité qui a déjà une image ne la remplace pas.

### Clés API : `keys`

```ts
keys: [{ id: 'hibp', label: 'Have I Been Pwned API key', url: 'https://haveibeenpwned.com/API/Key' }]
```

- `id` identifie la clé dans le coffre ; **partagez-le** entre tous les modules d'un même
  service (une seule saisie pour l'utilisateur). Pour éviter les fautes de frappe, déclarez la
  clé dans une constante (`const KEY = { ... }`) réutilisée par ces modules.
- `url` mène à la page où obtenir la clé ; elle est affichée dans le coffre.
- `optional: true` : le module fonctionne sans clé, avec des résultats réduits ou un quota
  plus faible. Sinon, le module n'est proposé qu'une fois la clé saisie.
- La valeur se lit avec `ctx.key(id)`. Les clés sont chiffrées par le système
  (`safeStorage` d'Electron : DPAPI sous Windows, trousseau GNOME ou KWallet sous Linux) et
  ne doivent jamais apparaître dans `raw`, dans un message d'erreur ou dans les journaux.

### À la demande : `ondemand`

Pour un service **payant ou à crédits** (HLR, roso.info...), mettez `ondemand: true` : le
module n'est jamais lancé automatiquement, seulement quand l'utilisateur le choisit
explicitement sur un nœud. Indiquez le coût dans la description quand il est connu.

### Bruyant : `noisy`

Un module est bruyant s'il peut **alerter la personne recherchée** ou laisser une trace chez
elle : demande de réinitialisation de mot de passe, envoi d'un code, notification « quelqu'un
a consulté votre profil ». Préférez toujours une méthode silencieuse ; si ce n'est pas possible,
`noisy: true` affiche le badge « peut alerter la cible » dans la vue Modules : l'utilisateur
peut le désactiver depuis cette même vue.

### Expérimental : `experimental`

Pour un module dont la détection est fragile (page HTML susceptible de changer, protection
anti-robot intermittente) ou dont les résultats n'ont pas pu être vérifiés sur un vrai compte.
L'interface le signale ; retirez le drapeau quand le module a fait ses preuves.

### Bonnes manières

- Une requête par information, pas de boucle agressive : regroupez les appels quand l'API le
  permet et respectez les quotas annoncés.
- Respectez les conditions d'utilisation et les politiques des services (User-Agent descriptif
  quand il est demandé, comme chez Wikimedia). Pas de contournement de captcha, pas de test de
  mot de passe, pas d'accès à des données non publiques sans la clé de l'utilisateur.
- `raw` est conservé (tronqué à 200 000 caractères) : n'y mettez que ce qui aide à vérifier le
  résultat, sans clé ni jeton.
- Libellés de liens et de propriétés dans la langue de `ctx.lang` ; les **clés** de
  propriétés restent en anglais, en `snake_case`.

## Exemple complet : Wikidata

Ce module prend une **personne** (nom et prénom), la cherche dans Wikidata et renvoie sa
description, ses dates de naissance et de décès (frise), son lieu de naissance avec ses
coordonnées (carte), son site officiel, son compte X et son portrait (image jointe). L'API est
publique et sans clé.

`src/main/modules/person/wikidata.ts` :

```ts
// Wikidata : fiche d'une personnalité publique (naissance, décès, lieu de
// naissance, site officiel, compte X, portrait). API publique, sans clé.

import { defineModule, ModuleError, type HttpError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'

const API = 'https://www.wikidata.org/w/api.php'
// Politique de Wikimedia : un User-Agent qui identifie l'outil et permet de le contacter.
const USER_AGENT = 'MASINT (https://github.com/mateo-brl/masint)'

interface SearchResponse {
  search?: Array<{ id: string; label?: string; description?: string }>
}

interface Claim {
  mainsnak?: { datavalue?: { value?: unknown } }
}

export interface WdEntity {
  id: string
  labels?: Record<string, { value: string }>
  descriptions?: Record<string, { value: string }>
  claims?: Record<string, Claim[]>
}

interface EntitiesResponse {
  entities?: Record<string, WdEntity>
}

/** Valeurs d'une propriété Wikidata (P569 = naissance, P18 = image...). */
function values<T>(e: WdEntity, prop: string): T[] {
  return (e.claims?.[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value as T).filter((v) => v !== undefined)
}

const first = <T>(e: WdEntity, prop: string): T | undefined => values<T>(e, prop)[0]

/** `+1867-11-07T00:00:00Z` → `1867-11-07` ; précision réduite si le jour ou le mois manque. */
export function wikidataDate(v: { time?: string } | undefined): string | null {
  const m = v?.time?.match(/^\+?(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return mo === '00' ? y : d === '00' ? `${y}-${mo}` : `${y}-${mo}-${d}`
}

/** Un élément Wikidata est une personne si P31 (nature de l'élément) vaut Q5 (être humain). */
export const isHuman = (e: WdEntity): boolean => values<{ id?: string }>(e, 'P31').some((v) => v.id === 'Q5')

/** Appel de l'API Wikidata ; un refus pour quota devient une erreur explicite. */
async function api<T>(ctx: ModuleContext, query: Record<string, string | number>): Promise<T> {
  try {
    return await ctx.fetchJson<T>(API, { query: { ...query, format: 'json' }, headers: { 'user-agent': USER_AGENT } })
  } catch (e) {
    if ((e as HttpError).status === 429) throw new ModuleError('Wikidata : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw e
  }
}

const label = (e: WdEntity, lang: string): string | undefined => (e.labels?.[lang] ?? e.labels?.en)?.value

export default defineModule({
  id: 'person.wikidata',
  name: { fr: 'Wikidata (personnalité publique)', en: 'Wikidata (public figure)' },
  description: {
    fr: 'Cherche la personne dans Wikidata : description, dates de naissance et de décès, lieu de naissance (placé sur la carte), site officiel, compte X et portrait.',
    en: 'Looks the person up in Wikidata: description, birth and death dates, birthplace (shown on the map), official website, X account and portrait.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.wikidata.org',
  async run(input, ctx) {
    const fr = ctx.lang === 'fr'
    const name = input.label.trim()
    if (name.length < 3) throw new ModuleError(fr ? 'Nom trop court' : 'Name too short', 'invalid_input')

    // 1. Recherche plein texte : jusqu'à 5 éléments candidats.
    const search = await api<SearchResponse>(ctx, {
      action: 'wbsearchentities',
      search: name,
      language: ctx.lang,
      uselang: ctx.lang,
      type: 'item',
      limit: 5
    })
    const ids = (search.search ?? []).map((s) => s.id)
    if (!ids.length) return {}

    // 2. Détail des candidats en une requête ; on garde le premier être humain.
    const details = await api<EntitiesResponse>(ctx, {
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|descriptions|claims',
      languages: `${ctx.lang}|en`
    })
    const person = ids.map((id) => details.entities?.[id]).find((e): e is WdEntity => !!e && isHuman(e))
    if (!person) return {}

    const entities: OutEntity[] = []

    // 3. Lieu de naissance avec ses coordonnées : lat/lon le placent sur la carte.
    const birthPlaceId = first<{ id?: string }>(person, 'P19')?.id
    if (birthPlaceId) {
      const places = await api<EntitiesResponse>(ctx, {
        action: 'wbgetentities',
        ids: birthPlaceId,
        props: 'labels|claims',
        languages: `${ctx.lang}|en`
      })
      const place = places.entities?.[birthPlaceId]
      const coords = place && first<{ latitude: number; longitude: number }>(place, 'P625')
      const placeName = place && label(place, ctx.lang)
      if (placeName) {
        entities.push({
          type: 'city',
          label: placeName,
          data: coords ? { lat: coords.latitude, lon: coords.longitude } : {},
          linkLabel: fr ? 'lieu de naissance' : 'birthplace'
        })
      }
    }

    const website = first<string>(person, 'P856')
    if (website) entities.push({ type: 'website', label: website, linkLabel: fr ? 'site officiel' : 'official website' })

    const xHandle = first<string>(person, 'P2002')
    if (xHandle) {
      entities.push({
        type: 'account',
        platform: 'x',
        label: xHandle,
        data: { username: xHandle, url: `https://x.com/${xHandle}` },
        linkLabel: fr ? 'compte X' : 'X account'
      })
    }

    // 4. Portrait : l'URL est téléchargée par le moteur (via le proxy) et jointe au nœud.
    const portrait = first<string>(person, 'P18')
    if (portrait) {
      const file = encodeURIComponent(portrait.replace(/ /g, '_'))
      entities.push({
        type: 'photo',
        label: `Wikimedia Commons : ${portrait}`,
        image: `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=512`,
        data: { url: `https://commons.wikimedia.org/wiki/File:${file}` },
        linkLabel: 'portrait'
      })
    }

    // Propriétés fusionnées dans le nœud d'origine ; les clés *_date alimentent la frise.
    const properties: Record<string, PropValue> = {
      wikidata_id: person.id,
      wikidata_url: `https://www.wikidata.org/wiki/${person.id}`,
      description: (person.descriptions?.[ctx.lang] ?? person.descriptions?.en)?.value ?? null,
      birth_date: wikidataDate(first(person, 'P569')),
      death_date: wikidataDate(first(person, 'P570'))
    }

    return { properties, entities, raw: { id: person.id, candidates: ids } }
  }
})
```

Points à retenir :

- les fonctions pures (`wikidataDate`, `isHuman`) sont **exportées** pour être testées sans
  réseau ;
- toutes les requêtes passent par `ctx.fetchJson` : proxy, Tor, délai et annulation sont gérés ;
- « rien trouvé » renvoie `{}`, un quota dépassé lève une `ModuleError` explicite ;
- `birth_date` et `death_date` alimentent la frise, `lat` / `lon` de la ville la placent sur
  la carte, `image` joint le portrait au nœud `photo`.

Après `npm run dev`, le module apparaît dans la vue Modules et dans le panneau de propriétés
(bouton « Enrichir ») de toute entité de type « Nom et prénom ».

## Tests

Les tests utilisent [Vitest](https://vitest.dev) et vivent dans `tests/` :

```
tests/
  helpers/context.ts       makeContext(), entity(), runModule(), LIVE
  fixtures/<famille>/      réponses enregistrées (JSON, HTML, texte)
  modules/<famille>.test.ts
  core/                    moteur et base SQLite (npm run test:core)
```

Deux niveaux de tests par module :

1. **Hors ligne, sur fixtures** (toujours exécutés, en CI comme en local). On enregistre une
   vraie réponse du service dans `tests/fixtures/<famille>/`, **réduite** à ce qui sert au test
   et **anonymisée** (aucune donnée personnelle réelle hors personnalités publiques, aucune
   clé). On teste les fonctions de parsing exportées, puis le module entier en remplaçant
   `ctx.fetchJson` ou `ctx.fetch` par une fonction qui renvoie les fixtures.
2. **En direct** (`LIVE=1`), contre le vrai service, dans un bloc `describe.skipIf(!LIVE)`.
   Ces tests ne tournent jamais en CI : ils servent à vérifier qu'une API n'a pas changé.

`tests/modules/person.test.ts` pour l'exemple ci-dessus :

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FetchOptions } from '@shared/modules'
import wikidata, { isHuman, wikidataDate, type WdEntity } from '../../src/main/modules/person/wikidata'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, '../fixtures/person', name), 'utf8'))

describe('person.wikidata', () => {
  it('convertit les dates Wikidata', () => {
    expect(wikidataDate({ time: '+1867-11-07T00:00:00Z' })).toBe('1867-11-07')
    expect(wikidataDate({ time: '+1900-00-00T00:00:00Z' })).toBe('1900')
    expect(wikidataDate(undefined)).toBeNull()
  })

  it('reconnaît un être humain', () => {
    const e: WdEntity = { id: 'Q1', claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } }
    expect(isHuman(e)).toBe(true)
    expect(isHuman({ id: 'Q2' })).toBe(false)
  })

  it('construit la fiche à partir des réponses enregistrées', async () => {
    const ctx = makeContext()
    ctx.fetchJson = async <T>(_url: string, init?: FetchOptions): Promise<T> => {
      const q = init?.query ?? {}
      if (q.action === 'wbsearchentities') return fixture('wikidata_search_curie.json') as T
      if (q.ids === 'Q9365159') return fixture('wikidata_place_freta.json') as T
      return fixture('wikidata_entities_curie.json') as T
    }
    const out = await runModule(wikidata, entity('person', 'Marie Curie'), ctx)
    expect(out.properties?.birth_date).toBe('1867-11-07')
    expect(out.entities?.find((e) => e.type === 'city')?.data?.lat).toBeCloseTo(52.25, 1)
    expect(out.entities?.some((e) => e.type === 'photo' && e.image?.includes('Special:FilePath'))).toBe(true)
  })
})

describe.skipIf(!LIVE)('person.wikidata (live)', () => {
  it('trouve Marie Curie', async () => {
    const out = await runModule(wikidata, entity('person', 'Marie Curie'))
    expect(out.properties?.wikidata_id).toBe('Q7186')
    expect(out.properties?.death_date).toBe('1934-07-04')
  })
})
```

Commandes :

```bash
npm test                                   # tous les tests hors ligne
npx vitest run tests/modules/person.test.ts  # un seul fichier
LIVE=1 npm test                            # avec les tests en direct (réseau)
npm run test:core                          # moteur et base (Electron en mode Node)
```

Sous Windows (PowerShell) : `$env:LIVE=1; npm test`.

- `makeContext()` reprend la variable `HTTPS_PROXY` si elle est définie, et accepte
  `{ keys, settings, lang }`.
- Les clés API des tests en direct se passent par variables d'environnement :
  `MASINT_KEY_<ID>` (id en majuscules, caractères non alphanumériques remplacés par `_`), par
  exemple `MASINT_KEY_HIBP=... LIVE=1 npm test`. Conditionnez ces tests avec
  `it.skipIf(!process.env.MASINT_KEY_HIBP)`.
- Les tests de `tests/core/` utilisent better-sqlite3, compilé pour Electron : ils tournent
  avec `npm run test:core`, qui lance Vitest dans Electron en mode Node
  (`ELECTRON_RUN_AS_NODE=1`). `npm test` les exclut.

## Avant d'ouvrir une pull request

- [ ] `npm run typecheck`, `npm test` et `npm run test:core` passent.
- [ ] Le module a un test hors ligne avec fixture, et un test `LIVE` si le service est public.
- [ ] `name` et `description` existent en français et en anglais.
- [ ] Les drapeaux `ondemand`, `noisy`, `experimental` et les `keys` reflètent la réalité.
- [ ] Aucune donnée personnelle réelle ni clé dans le code, les fixtures ou `raw`.
- [ ] La liste des modules est régénérée (ci-dessous).

## Liste des modules

La liste à jour (identifiant, nom, catégorie, entrées, clés, remarques) est dans
**[modules-list.md](modules-list.md)**. Elle est produite par une analyse du code source,
sans l'exécuter :

```bash
node build/scripts/list-modules.mjs > docs/modules-list.md
# ou
npm run modules:list
```

Relancez cette commande après avoir ajouté, renommé ou modifié un module.
`node build/scripts/list-modules.mjs --json` produit la même liste en JSON.
