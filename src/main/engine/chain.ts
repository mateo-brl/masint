// Enchaînement contrôlé (pivot automatique) : force des liens, modules exclus, liste d'arrêt,
// pseudos trop courants et budgets d'une tâche « en chaîne ». Fonctions pures, testées sans base.

import type { OsintModule } from '@shared/modules'
import { PLATFORMS } from '@shared/platforms'
import type { GraphNode, LinkStrength } from '@shared/types'

/** Budget d'une tâche en chaîne ; le surplus part dans « À vérifier » (« budget atteint »). */
export const CHAIN_BUDGET = {
  /** Nouveaux nœuds créés par l'enchaînement, à chaque saut. */
  nodesPerHop: 30,
  /** Exécutions de modules, nœud de départ compris. */
  runs: 100,
  /** Durée de la tâche. */
  durationMs: 10 * 60_000
}

/** Un identifiant enrichi depuis moins longtemps (dans n'importe quelle enquête) n'est pas relancé. */
export const RECENT_ENRICH_MS = 24 * 3600_000

/** Au-delà, un compte est un compte de marque : on n'enchaîne pas dessus (sauf nœud de départ). */
export const BRAND_FOLLOWERS = 100_000

/** Recherche du pseudo sur des centaines de sites : seulement au premier saut. */
const PSEUDO_SEARCH = new Set(['username.sites', 'username.sites_extended'])

/** Seules ces forces donnent lieu à enchaînement ; les autres vont dans « À vérifier ». */
export function chainable(strength: LinkStrength): boolean {
  return strength === 'same' || strength === 'declared'
}

/**
 * Force par défaut quand le module ne la déclare pas. Les identifiants personnels (compte,
 * email, téléphone, site) sont supposés déclarés ; un pseudo seul est un rapprochement
 * fragile ; le reste (personne, organisation, adresse IP, domaine...) n'est qu'une mention :
 * l'enchaînement suit une identité, pas une infrastructure.
 */
export function defaultStrength(type: string): LinkStrength {
  switch (type) {
    case 'account':
    case 'email':
    case 'phone':
    case 'website':
    case 'url':
      return 'declared'
    case 'username':
      return 'weak'
    default:
      return 'mention'
  }
}

/**
 * Module jamais lancé par enchaînement : à la demande, bruyant, à clé obligatoire (crédits,
 * quotas), recherche de pseudo au-delà du premier saut, module web sur une URL.
 */
export function chainExcluded(m: Pick<OsintModule, 'id' | 'category' | 'ondemand' | 'noisy' | 'keys'>, node: Pick<GraphNode, 'type'>, depth: number): boolean {
  if (m.ondemand || m.noisy) return true
  if ((m.keys ?? []).some((k) => !k.optional)) return true
  if (PSEUDO_SEARCH.has(m.id) && depth > 1) return true
  if (node.type === 'url' && m.category === 'web') return true
  return false
}

// ---------------------------------------------------------------------------
// Liste d'arrêt

const hostOf = (raw: string): string | null => {
  const s = raw.trim()
  if (!s) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Domaines des plateformes du catalogue (modèles d'URL de profil) et des fournisseurs d'email. */
const PLATFORM_HOSTS = new Set<string>([
  ...PLATFORMS.flatMap((p) => {
    const m = p.url?.match(/^https?:\/\/(?:\{u\}\.)?([^/{}]+)/i)
    return m ? [m[1].toLowerCase().replace(/^www\./, '')] : []
  }),
  ...PLATFORMS.flatMap((p) => p.domains ?? []).map((d) => d.toLowerCase()),
  // Grands services absents du catalogue des profils.
  'google.com', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'amazon.com', 'amazon.fr', 'facebook.com',
  'facebookmail.com', 'twitter.com', 'linkedin.com', 'paypal.com', 'gravatar.com', 'wordpress.com', 'wordpress.org',
  'automattic.com', 'mozilla.org', 'mozilla.com', 'yahoo.com', 'discord.com', 'discord.gg', 'telegram.org', 't.me',
  'whatsapp.com', 'medium.com', 'substack.com', 'patreon.com', 'linktr.ee', 'keybase.io', 'npmjs.com', 'pypi.org'
])

const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 't.co', 'goo.gl', 'tinyurl.com', 'ow.ly', 'buff.ly', 'is.gd', 'v.gd', 'cutt.ly', 'rebrand.ly',
  'shorturl.at', 'rb.gy', 't.ly', 'lnkd.in', 'youtu.be', 'bit.do', 'tiny.cc', 's.id', 'amzn.to', 'fb.me', 'dlvr.it',
  'tr.im', 'qr.ae', 'shorte.st', 'adf.ly', 'bl.ink', 'soo.gd', 'trib.al', 'ift.tt', 'spoti.fi', 'apple.co'
])

/** Adresses techniques, génériques partout. */
const SYSTEM_LOCALS = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?)([+._-].*)?$/
/** Adresses de rôle, génériques chez les grands services. */
const ROLE_LOCALS = new Set([
  'support', 'contact', 'info', 'hello', 'help', 'admin', 'abuse', 'security', 'privacy', 'press', 'legal', 'sales',
  'team', 'newsletter', 'marketing', 'billing', 'webmaster', 'hostmaster', 'feedback', 'service', 'customerservice',
  'jobs', 'careers', 'dpo', 'compliance', 'partners', 'media'
])

/** Adresse générique : technique (noreply@...) ou de rôle d'un grand service (support@github.com). */
export function isGenericAddress(email: string): boolean {
  const [local, domain] = email.trim().toLowerCase().split('@')
  if (!local || !domain) return false
  if (SYSTEM_LOCALS.test(local)) return true
  return ROLE_LOCALS.has(local) && (PLATFORM_HOSTS.has(domain) || PLATFORM_HOSTS.has(domain.split('.').slice(-2).join('.')))
}

export function isShortener(value: string): boolean {
  const h = hostOf(value)
  return !!h && SHORTENERS.has(h)
}

/** Page d'accueil (ou domaine) d'une plateforme : https://github.com/, x.com, gmail.com. */
export function isPlatformHome(value: string): boolean {
  const s = value.trim()
  const h = hostOf(s)
  if (!h || !PLATFORM_HOSTS.has(h)) return false
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`)
    return u.pathname.replace(/\/+$/, '') === '' && !u.search
  } catch {
    return false
  }
}

/** Nombre d'abonnés connu du compte (propriétés `followers`, `subscribers`). */
function audience(node: Pick<GraphNode, 'data'>): number {
  let max = 0
  for (const key of ['followers', 'followers_count', 'subscribers', 'subscriber_count']) {
    const v = node.data?.[key]
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : 0
    if (n > max) max = n
  }
  return max
}

export function isBrandAccount(node: Pick<GraphNode, 'type' | 'data'>): boolean {
  return audience(node) > BRAND_FOLLOWERS
}

// ---------------------------------------------------------------------------
// Pseudos trop courants

// Prénoms courants (France, pays anglophones) et mots du dictionnaire fréquents comme pseudo :
// liste courte, embarquée. Les valeurs de moins de 5 caractères sont déjà écartées.
const FIRST_NAMES = new Set(
  (
    'adrien alexandre alexis alice amandine amelie anais andre anthony antoine arnaud arthur aurelie baptiste benjamin ' +
    'benoit bernard camille caroline catherine cedric celine charles charlotte chloe christian christine christophe ' +
    'claire clement coralie damien daniel david delphine denis didier dominique dylan eloise elodie emilie emma ' +
    'emmanuel enzo eric etienne fabien fabrice florian francis francois frederic gabriel gerard guillaume helene ' +
    'henri hugo isabelle jacques jeremy jerome jessica joseph julie julien justine karine kevin laura laurent leonie ' +
    'louis louise lucas lucie manon marc marie marine martin mathieu mathilde matthieu maxime melanie michel morgane ' +
    'nathalie nicolas noemie olivier pascal patrick pauline philippe pierre quentin raphael romain sandrine sarah ' +
    'sebastien simon sophie stephane sylvie theo thierry thomas valentin valerie vincent virginie xavier yannick ' +
    'aaron adam alexander alexandra amanda andrew angela anthony ashley barbara brandon brian charlotte christopher ' +
    'daniel deborah dennis donna dorothy edward elizabeth emily emma ethan george gregory hannah heather jacob james ' +
    'jason jeffrey jennifer jessica jonathan joshua justin karen kenneth kevin kimberly larry laura linda lisa ' +
    'margaret mark matthew melissa michael michelle nancy nicholas nicole olivia patricia paul rachel raymond rebecca ' +
    'richard robert ronald ryan samantha samuel sandra sarah scott sharon shirley stephanie stephen steven susan ' +
    'thomas timothy tyler victoria william'
  ).split(/\s+/)
)

const WORDS = new Set(
  (
    'admin administrator anonymous anonyme apple angel alpha beauty black blade blogger blue bonjour cherry chocolate ' +
    'coder coffee cookie crazy dark death demon designer developer devil dragon dream eagle editor family fashion ' +
    'flower football friend gamer gaming games ghost girl golden green guest happy hello hacker hunter killer king ' +
    'legend light lover lucky magic master monster music mystery ninja nobody official photo photography pirate ' +
    'player power prince princess queen rainbow random raven reader rocket shadow silver smile snake soleil soccer ' +
    'sport sports summer sunshine super support tiger travel user utilisateur webmaster winter wizard world writer ' +
    'admin123 password secret student teacher test tester testing internet online video videos media studio'
  ).split(/\s+/)
)

/** Forme comparée : minuscules, sans accents, sans @ ni séparateurs. */
function normPseudo(s: string): string {
  return s
    .trim()
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[._\-\s]+/g, '')
}

/**
 * Pseudo trop courant pour être suivi automatiquement : moins de 5 caractères, prénom courant
 * ou mot du dictionnaire (« alex », « julien », « shadow »). Il ne donne pas lieu à enchaînement.
 */
export function isCommonPseudo(pseudo: string): boolean {
  const p = normPseudo(pseudo)
  if (p.length < 5) return true
  if (/^\d+$/.test(p)) return true
  return FIRST_NAMES.has(p) || WORDS.has(p)
}

/**
 * Raison de ne pas enchaîner sur ce nœud (liste d'arrêt, pseudo courant, compte de marque),
 * `null` s'il peut l'être. `isRoot` : le nœud de départ n'est pas concerné par la règle des
 * comptes de marque.
 */
export function stopReason(node: Pick<GraphNode, 'type' | 'label' | 'data'>, isRoot = false): string | null {
  const label = node.label.trim()
  const url = typeof node.data?.url === 'string' ? node.data.url : ''
  switch (node.type) {
    case 'email':
      if (isGenericAddress(label)) return 'generic-address'
      break
    case 'url':
    case 'website':
      if (isShortener(label) || (url && isShortener(url))) return 'shortener'
      if (isPlatformHome(label)) return 'platform-home'
      break
    case 'domain':
      if (isShortener(label)) return 'shortener'
      if (isPlatformHome(label)) return 'platform-home'
      break
    case 'username':
      if (isCommonPseudo(label)) return 'common-pseudo'
      break
  }
  if (!isRoot && isBrandAccount(node)) return 'brand-account'
  return null
}
