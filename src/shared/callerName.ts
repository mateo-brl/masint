// Noms donnés à un numéro par les annuaires d'appelants (Eyecon, Truecaller, CallApp,
// Sync.ME...) : c'est le nom sous lequel d'autres utilisateurs ont enregistré le numéro dans
// leur carnet d'adresses, ou celui que la communauté lui donne. Il peut s'agir du vrai nom du
// titulaire, d'un pseudo, ou d'une simple étiquette (« Maman », « Livreur », « Spam »).
//
// Le classement est volontairement prudent : seul un nom qui ressemble nettement à « Prénom
// Nom » devient une personne, seul un jeton qui a la forme d'un pseudo devient un pseudo, et les
// deux restent dans « À vérifier ». Tout le reste n'est qu'une propriété du nœud.
// Fonctions pures, testées hors ligne.

import type { LinkStrength, PropValue } from './types'
import { foldName, isFirstName } from './firstNames'

export type CallerNameKind = 'person' | 'username' | 'tag' | 'ambiguous'

export interface CallerNameClass {
  kind: CallerNameKind
  /** Nom nettoyé (espaces, guillemets, qualificatifs retirés), tel qu'il est proposé. */
  value: string
  /** Forme comparée pour la corroboration entre annuaires (ordre des mots ignoré). */
  key: string
  /** Qualificatifs retirés autour d'un nom (« Pro », « Perso »...). */
  qualifiers?: string[]
}

// ---------------------------------------------------------------------------
// Annuaires d'appelants

/**
 * Identifiants des annuaires d'appelants, sous leur forme comparée (minuscules, sans
 * ponctuation) : plateformes de platforms.ts et sites de roso.info, avec leur nom affiché.
 */
const CALLER_ID: Record<string, string> = {
  eyecon: 'Eyecon',
  truecaller: 'Truecaller',
  callapp: 'CallApp',
  getcontact: 'GetContact',
  syncme: 'Sync.ME',
  hiya: 'Hiya',
  showcaller: 'Showcaller',
  numbuster: 'NumBuster',
  viewcaller: 'ViewCaller',
  me: 'Me',
  meapp: 'Me',
  drupe: 'drupe',
  whoscall: 'Whoscall',
  cleverdialer: 'CleverDialer',
  spamcalls: 'Spamcalls',
  callfilter: 'Callfilter',
  phonely: 'Phonely',
  tellows: 'Tellows',
  callerid: 'Caller ID',
  twilio: 'Twilio (CNAM)'
}

const idKey = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Nom affiché de l'annuaire d'appelants, ou `null` si la plateforme n'en est pas un. */
export function callerIdSource(platformOrSite: string | null | undefined): string | null {
  if (!platformOrSite) return null
  return CALLER_ID[idKey(platformOrSite)] ?? null
}

export const isCallerIdPlatform = (platformOrSite: string | null | undefined): boolean => callerIdSource(platformOrSite) !== null

// ---------------------------------------------------------------------------
// Classement

/** Emojis, drapeaux, joints et sélecteurs de variante. */
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|‍|️|[☀-➿]/u

/**
 * Mots qui font d'un nom une étiquette : liens familiaux ou affectifs, métiers et services,
 * démarchage, numéros inconnus, livraisons, administrations et grandes marques. Les métiers
 * qui sont aussi des noms de famille courants (Boulanger, Boucher, Meunier...) n'y sont pas.
 */
const GENERIC_WORDS = new Set(
  (
    // Famille et proches
    'maman mam mama mamounette mamie mamy mami papa pap papy papi pere mere grandmere grandpere tata tati tatie tante ' +
    'tonton oncle frere frerot soeur sister brother bro sis cousin cousine fils fille daughter son beaupere bellemere ' +
    'beaufrere bellesoeur parrain marraine filleul filleule mom mum mommy mummy dad daddy grandma grandpa granny ' +
    'aunt auntie uncle nephew niece neveu niece ' +
    // Affection
    'cheri cherie cheri2 amour love lover honey hun babe baby bae bb bebe doudou chouchou loulou mamour moncoeur coeur ' +
    'darling sweetie sweetheart hubby wifey wife husband mari femme copain copine chum pote poto ami amie friend bff ex ' +
    'crush ' +
    // Travail
    'boulot travail taf taff job work office bureau collegue collegues coworker patron patronne boss chef manager ' +
    'client cliente clients fournisseur fournisseurs prestataire stagiaire rh ' +
    // Métiers et services
    'livreur livreuse livraison delivery courier coursier colis taxi vtc cab chauffeur driver uber bolt heetch ' +
    'deliveroo ubereats justeat pizza pizzeria kebab tacos sushi resto restaurant traiteur medecin docteur doctor doc ' +
    'dr dentiste kine kinesitherapeute osteo osteopathe infirmier infirmiere sagefemme pharmacie pharmacien ' +
    'veterinaire veto hopital clinique urgences plombier serrurier electricien garagiste garage mecanicien depannage ' +
    'depanneur coiffeur coiffeuse barbier estheticienne onglerie nounou babysitter baby-sitter creche ecole college ' +
    'lycee prof professeur maitresse instit mairie notaire avocat huissier comptable expertcomptable assureur ' +
    'assurance assurances mutuelle banque banquier conseiller conseillere agence immobilier agent proprio ' +
    'proprietaire locataire syndic gardien gardienne concierge voisin voisine voisins neighbor neighbour landlord ' +
    'agency plumber locksmith electrician mechanic dentist nurse teacher school bank insurance ' +
    'plomberie boulangerie boucherie charcuterie epicerie superette tabac carrosserie autoecole ambulance ambulances ' +
    'taxis pompesfunebres pressing laverie salon institut cabinet ' +
    // Formes de société
    'sarl sas sasu eurl sa sci scp snc ets etablissements entreprise societe btp ltd inc llc corp gmbh ' +
    // Démarchage, inconnus, signalements
    'spam spammeur spammer arnaque arnaqueur escroc escroquerie scam scammer fraud fraude fraudster demarchage ' +
    'demarcheur prospection telemarketing telemarketer telemarketeur publicite pub pubs sondage robocall robot ' +
    'inconnu inconnue unknown anonyme anonymous masque private prive blocked bloque suspect suspicious harcelement ' +
    'harceleur relou chiant pasrepondre nepasrepondre ' +
    // Services clients, administrations et marques
    'sav service support hotline standard accueil reception info infos contact contacts commercial vente ventes ' +
    'amazon chronopost colissimo laposte dpd ups dhl fedex gls relais mondialrelay edf engie totalenergies gdf orange ' +
    'sfr bouygues freemobile cpam ameli caf urssaf impots tresor poleemploi francetravail sncf ratp leboncoin vinted ' +
    'doctolib bnp lcl axa maif macif matmut allianz groupama cic cetelem cofidis sofinco'
  ).split(/\s+/)
)

/** Expressions génériques sur plusieurs mots. */
const GENERIC_PHRASES = [
  'ne pas repondre',
  'ne pas decrocher',
  'pas repondre',
  'do not answer',
  'dont answer',
  'numero masque',
  'numero prive',
  'appel masque',
  'private number',
  'unknown caller',
  'wireless caller',
  'call center',
  'centre d appel',
  'centre d appels',
  'service client',
  'service clients',
  'spam risk',
  'scam likely',
  'potential spam',
  'potential fraud',
  'mon coeur',
  'mon amour',
  'ma cherie',
  'mon cheri',
  'ma puce',
  'la poste',
  'pole emploi',
  'france travail',
  'societe generale',
  'credit agricole',
  'caisse d epargne',
  'banque populaire',
  'free mobile'
]

/** Qualificatifs d'un numéro, retirés autour d'un nom (« Jean Dupont Pro »). */
const QUALIFIERS = new Set(
  (
    'pro perso personnel travail boulot taf bureau work office mobile portable port fixe domicile maison home cell tel ' +
    'whatsapp wa new nouveau nouvelle ancien old bis 2 3'
  ).split(/\s+/)
)

/** Particules des noms de famille (« de La Fontaine », « van Dijk »). */
const PARTICLES = new Set('de du des d le la les van von der den da di del della dos das el al ben bin ibn bou abou mac mc st saint sainte'.split(' '))

/**
 * Mots courants qui ne font pas un pseudo à eux seuls (« Bonjour », « Soleil »). Les mots
 * génériques ci-dessus en font déjà partie.
 */
const COMMON_WORDS = new Set(
  (
    'bonjour salut hello coucou merci oui non soleil lune etoile ciel mer ocean fleur rose amour ange angel dragon ' +
    'tigre lion loup wolf king queen prince princesse princess star super mega ultra boss best team game gamer ' +
    'player music musique photo video sport football foot basket tennis moto auto voiture velo paris lyon marseille ' +
    'france london new york monsieur madame mademoiselle mister miss sir lady numero number phone telephone appel ' +
    'call contact test essai demo admin user utilisateur personne quelqu un someone nobody'
  ).split(/\s+/)
)

/** Forme comparée d'un nom : minuscules, sans accents ni ponctuation, espaces simples. */
export function foldCallerName(s: string): string {
  return foldName(s)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Mot comparé : minuscules, sans accents ni séparateurs (« Chéri » → `cheri`, « Baby-Sitter » → `babysitter`). */
const word = (t: string): string => foldName(t).replace(/[^a-z0-9]/g, '')

const isCaps = (t: string): boolean => t.length > 1 && t === t.toUpperCase() && t !== t.toLowerCase()
const isTitle = (t: string): boolean => /^\p{Lu}\p{Ll}/u.test(t)
/** Mot d'un nom de personne : lettres, avec tiret ou apostrophe internes, deux lettres au moins. */
const NAME_TOKEN = /^\p{L}[\p{L}\p{M}'’-]*\p{L}$/u

function make(kind: CallerNameKind, value: string, qualifiers: string[] = []): CallerNameClass {
  const folded = foldCallerName(value)
  // Personne : l'ordre des mots ne compte pas (« DUPONT Jean » et « Jean Dupont »).
  const key = kind === 'person' ? folded.split(' ').sort().join(' ') : folded
  return { kind, value, key, ...(qualifiers.length ? { qualifiers } : {}) }
}

/**
 * Forme d'un pseudo : un seul jeton de 4 à 30 caractères (lettres, chiffres, `.`, `_`, `-`) qui
 * mêle lettres et chiffres, contient un séparateur interne ou une majuscule au milieu d'un mot
 * (`ZX445`, `jdupont_75`, `DarkAngel`). Un mot simple (« Dupont », « soleil ») n'en est pas un.
 */
function pseudoShape(t: string): boolean {
  if (!/^[\p{L}\p{N}._-]{4,30}$/u.test(t)) return false
  if (!/\p{L}/u.test(t) || /^[._-]|[._-]$/.test(t)) return false
  return /\p{N}/u.test(t) || /[._-]/.test(t) || /\p{Ll}\p{Lu}/u.test(t)
}

/**
 * Classe un nom d'appelant :
 * - `person` : « Prénom Nom » (2 à 4 mots alphabétiques, premier mot prénom courant) ou nom
 *   de famille en capitales (« DUPONT Jean ») ;
 * - `username` : un seul jeton qui a la forme d'un pseudo (`ZX445`), ni mot courant ni prénom ;
 * - `tag` : étiquette générique (« Spam », « Maman ❤️ », « Livraison Amazon », un numéro) ;
 * - `ambiguous` : le reste (prénom seul, nom de famille seul, initiales...).
 */
export function classifyCallerName(raw: string): CallerNameClass {
  const clean = String(raw ?? '')
    .normalize('NFC')
    .replace(/[​‌‎‏⁠]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«»“”‘’]+|["'«»“”‘’]+$/g, '')
    .trim()
  if (!clean) return make('ambiguous', '')
  if (EMOJI.test(clean)) return make('tag', clean)
  // Un numéro ou une suite de chiffres n'est pas un nom.
  if (/^[+\d\s().\-/#*]+$/.test(clean) && /\d/.test(clean)) return make('tag', clean)
  if (clean.length > 60) return make('ambiguous', clean)
  const folded = foldCallerName(clean)
  const spaced = ` ${folded.replace(/-/g, ' ')} `
  if (GENERIC_PHRASES.some((p) => spaced.includes(` ${p} `))) return make('tag', clean)

  // Qualificatifs retirés aux deux bouts : « Jean Dupont Pro » reste « Jean Dupont ».
  let tokens = clean.split(' ')
  const qualifiers: string[] = []
  while (tokens.length && QUALIFIERS.has(word(tokens[tokens.length - 1]))) qualifiers.unshift(tokens.pop()!)
  while (tokens.length && QUALIFIERS.has(word(tokens[0]))) qualifiers.push(tokens.shift()!)
  if (!tokens.length) return make('tag', clean)
  const value = tokens.join(' ')
  if (tokens.some((t) => GENERIC_WORDS.has(word(t)))) return make('tag', clean)

  if (tokens.length === 1) {
    const t = tokens[0]
    if (isFirstName(t)) return make('ambiguous', value, qualifiers)
    if (COMMON_WORDS.has(word(t))) return make('ambiguous', value, qualifiers)
    // Prénom suivi de chiffres (« Julien75 ») : trop courant pour être suivi comme un pseudo.
    if (pseudoShape(t) && !isFirstName(t.replace(/[\d._-]+$/, '').replace(/^[\d._-]+/, ''))) return make('username', value, qualifiers)
    return make('ambiguous', value, qualifiers)
  }

  if (tokens.length > 4 || !tokens.every((t) => NAME_TOKEN.test(t))) return make('ambiguous', value, qualifiers)
  const significant = tokens.filter((t) => !PARTICLES.has(word(t)))
  if (significant.length < 2) return make('ambiguous', value, qualifiers)
  if (tokens.some((t) => COMMON_WORDS.has(word(t)) && !isFirstName(t))) return make('ambiguous', value, qualifiers)
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  // « Jean Dupont », « Jean-Pierre MARTIN ».
  if (isFirstName(first) && !PARTICLES.has(word(last))) return make('person', value, qualifiers)
  // « DUPONT Jean » : nom de famille en capitales, puis le prénom.
  if (isCaps(first) && isFirstName(last)) return make('person', value, qualifiers)
  // Nom de famille en capitales à côté d'un prénom en minuscules (« Kofi MENSAH », « NGOMA Aya »).
  if (significant.some(isCaps) && significant.some((t) => !isCaps(t) && isTitle(t))) return make('person', value, qualifiers)
  return make('ambiguous', value, qualifiers)
}

// ---------------------------------------------------------------------------
// Pivots

export interface CallerNameSource {
  /** Nom donné au numéro, tel que l'annuaire l'affiche. */
  name: string
  /** Annuaire (« Eyecon », « Truecaller »). */
  source: string
}

export interface CallerNameGroup extends CallerNameClass {
  sources: string[]
}

/**
 * Entité proposée (compatible avec `OutEntity` des modules, que l'interface n'importe pas) :
 * toujours à vérifier.
 */
export interface CallerEntity {
  type: 'person' | 'username'
  label: string
  review: true
  reviewReason: string
  strength: LinkStrength
  linkLabel: string
  data: Record<string, PropValue>
}

export interface CallerPivots {
  /** Personnes et pseudos, toujours dans « À vérifier ». */
  entities: CallerEntity[]
  /** `caller_names` (noms vus, avec leurs annuaires) et `caller_tags` (étiquettes génériques). */
  properties: Record<string, PropValue>
  groups: CallerNameGroup[]
}

type Lang = 'fr' | 'en'

/** « Eyecon », « Eyecon et Truecaller », « Eyecon, CallApp et Truecaller ». */
export function joinSources(sources: string[], lang: Lang): string {
  if (sources.length <= 1) return sources[0] ?? ''
  return `${sources.slice(0, -1).join(', ')} ${lang === 'fr' ? 'et' : 'and'} ${sources[sources.length - 1]}`
}

/** Raison affichée dans « À vérifier » : où le nom a été vu, et ce qu'il peut être. */
export function callerReason(kind: 'person' | 'username', sources: string[], lang: Lang): string {
  const list = joinSources(sources, lang)
  const many = sources.length > 1
  if (kind === 'person') {
    if (lang === 'fr') return many ? `nom donné au numéro, vu dans ${list}` : `nom donné au numéro dans ${list}`
    return many ? `name given to the number, seen in ${list}` : `name given to the number in ${list}`
  }
  if (lang === 'fr')
    return many
      ? `nom sous lequel le numéro est enregistré, vu dans ${list} : peut-être un pseudo`
      : `nom sous lequel le numéro est enregistré dans ${list} : peut-être un pseudo`
  return many ? `name the number is saved under, seen in ${list}: maybe a username` : `name the number is saved under in ${list}: maybe a username`
}

const MAX_GROUPS = 20

/**
 * Noms donnés à un numéro par un ou plusieurs annuaires : les noms identiques (casse, accents,
 * ordre des mots ignorés) sont regroupés et leurs annuaires cités ensemble. Personnes et pseudos
 * deviennent des entités à vérifier ; tout nom vu reste dans les propriétés du nœud.
 */
export function callerNamePivots(list: CallerNameSource[], lang: Lang): CallerPivots {
  const groups = new Map<string, CallerNameGroup>()
  for (const { name, source } of list) {
    const c = classifyCallerName(name)
    if (!c.value) continue
    const id = `${c.kind}|${c.key}`
    const g = groups.get(id) ?? { ...c, sources: [] }
    if (source && !g.sources.includes(source)) g.sources.push(source)
    groups.set(id, g)
  }
  const all = [...groups.values()].slice(0, MAX_GROUPS)
  const label = (g: CallerNameGroup): string => (g.sources.length ? `${g.value} (${g.sources.join(', ')})` : g.value)
  const entities: CallerEntity[] = []
  for (const g of all) {
    if (g.kind !== 'person' && g.kind !== 'username') continue
    entities.push({
      type: g.kind,
      label: g.value,
      // Nom choisi par un tiers (carnet d'adresses, communauté) : jamais une identité établie.
      review: true,
      reviewReason: callerReason(g.kind, g.sources, lang),
      strength: 'weak',
      linkLabel:
        g.kind === 'person'
          ? lang === 'fr'
            ? 'nom (annuaire d’appelants)'
            : 'name (caller ID)'
          : lang === 'fr'
            ? 'pseudo possible (annuaire d’appelants)'
            : 'possible username (caller ID)',
      data: {
        caller_id_sources: g.sources,
        ...(g.qualifiers ? { caller_qualifiers: g.qualifiers } : {})
      }
    })
  }
  const names = all.filter((g) => g.kind !== 'tag').map(label)
  const tags = all.filter((g) => g.kind === 'tag').map(label)
  return {
    entities,
    properties: { ...(names.length ? { caller_names: names } : {}), ...(tags.length ? { caller_tags: tags } : {}) },
    groups: all
  }
}
