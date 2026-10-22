// Comptes des plateformes sans module dédié (Instagram, Facebook, LinkedIn, Pinterest, Threads,
// VK, Vinted...) : leur lecture automatique est impossible sans compte (401, 403, 429 ou
// redirection vers la connexion). Le module propose l'ouverture du profil dans « À vérifier »,
// avec ce qu'il faut y relever, et complète l'URL du profil. Aucune requête réseau.

import { defineModule, type InputEntity, type ModuleOutput, type OsintModule } from '@shared/modules'
import { getPlatform, profileUrl } from '@shared/platforms'

// Modules des autres familles, chargés une fois : un compte qu'un module de plateforme sait lire
// n'a pas besoin d'une vérification manuelle. Pas d'import du registre : il charge ce fichier.
const files = import.meta.glob<{ default?: OsintModule | OsintModule[]; modules?: OsintModule[] }>(
  ['../**/*.ts', '!../**/_*.ts', '!../**/_*/**', '!../social/profileManual.ts'],
  { eager: true }
)

const ID = 'social.profile_manual'

let platformModules: OsintModule[] | null = null

/** Modules de plateforme (réseaux sociaux, messageries) qui acceptent les comptes. */
function dedicatedModules(): OsintModule[] {
  if (platformModules) return platformModules
  const all = Object.values(files).flatMap((f) => [...(Array.isArray(f.default) ? f.default : [f.default]), ...(f.modules ?? [])])
  platformModules = all.filter(
    (m): m is OsintModule =>
      !!m && typeof m.run === 'function' && (m.category === 'social' || m.category === 'messaging') && m.inputTypes.includes('account') && !!m.accepts
  )
  return platformModules
}

/**
 * Un module de plateforme lit-il ce compte ? Il doit l'accepter, mais pas un compte neutre :
 * un filtre qui accepte tout compte n'est pas propre à une plateforme.
 */
export function hasDedicatedModule(input: InputEntity, modules: OsintModule[] = dedicatedModules()): boolean {
  const neutral: InputEntity = { ...input, platform: '__aucune__', data: {} }
  return modules.some(
    (m) => m.id !== ID && !!m.accepts && m.accepts(input) && !m.accepts(neutral) && !PARTIAL[m.id]?.includes(input.platform ?? '')
  )
}

/**
 * Modules qui lisent une plateforme par un détour, sans remplacer l'ouverture du profil :
 * Threads ne donne qu'une partie du profil Instagram du même pseudo.
 */
const PARTIAL: Record<string, string[]> = { 'social.threads': ['instagram'] }

// Messageries dont la page publique n'est qu'un bouton « ouvrir la conversation ».
const NO_PROFILE_PAGE = new Set(['whatsapp', 'signal', 'skype', 'teams', 'viber', 'wechat', 'line', 'threema', 'kik', 'session', 'matrix', 'wire'])

/** URL du profil : celle déjà connue, sinon le modèle de la plateforme. */
export function manualProfileUrl(input: InputEntity): string | null {
  const known = typeof input.data.url === 'string' && /^https?:\/\//i.test(input.data.url) ? input.data.url : null
  if (known) return known
  const platform = input.platform
  if (!platform || NO_PROFILE_PAGE.has(platform)) return null
  const user = (typeof input.data.username === 'string' && input.data.username ? input.data.username : input.label).trim().replace(/^@/, '')
  if (!user || /\s/.test(user)) return null
  // Identifiant numérique Facebook : l'adresse en /<id> n'est pas toujours résolue.
  if (platform === 'facebook' && /^\d{5,20}$/.test(user)) return `https://www.facebook.com/profile.php?id=${user}`
  // Vinted : les profils sont adressés par leur identifiant numérique (`12345678` ou `12345678-pseudo`).
  if (platform === 'vinted') return /^\d{3,12}(-[\w.-]+)?$/.test(user) ? `https://www.vinted.fr/member/${user}` : null
  return profileUrl(platform, user) ?? null
}

/** Ce qu'il faut relever sur la page, selon la plateforme. */
export function profileHint(platform: string | null, lang: 'fr' | 'en'): string {
  const base =
    lang === 'fr'
      ? 'Relever la bio, les liens, le nombre d’abonnés et d’abonnements, les photos publiées (lieux, personnes, objets reconnaissables) et la date de création ou de première publication.'
      : 'Note the bio, links, follower and following counts, posted photos (places, people, recognisable objects) and the creation or first post date.'
  const extra: Record<string, { fr: string; en: string }> = {
    instagram: { fr: 'Compte public ou privé, lien en bio, publications géolocalisées, comptes identifiés sur les photos.', en: 'Public or private account, link in bio, geotagged posts, accounts tagged in photos.' },
    facebook: { fr: 'Ville, emploi, études, liens de parenté, amis visibles, photos de profil et de couverture.', en: 'City, work, education, family links, visible friends, profile and cover photos.' },
    linkedin: { fr: 'Poste actuel, employeurs successifs, formation, ville, compétences et relations communes.', en: 'Current position, past employers, education, city, skills and mutual connections.' },
    threads: { fr: 'Compte Instagram associé (même pseudo), réponses et mentions.', en: 'Linked Instagram account (same username), replies and mentions.' },
    vk: { fr: 'Ville, date de naissance, établissements, proches et groupes.', en: 'City, birth date, schools, relatives and groups.' },
    okru: { fr: 'Ville, date de naissance, établissements, proches et groupes.', en: 'City, birth date, schools, relatives and groups.' },
    vinted: { fr: 'Ville, évaluations et commentaires, date d’inscription, articles en vente.', en: 'City, ratings and reviews, sign-up date, items for sale.' },
    ebay: { fr: 'Pays, évaluations, date d’inscription, objets en vente.', en: 'Country, feedback, sign-up date, items for sale.' },
    etsy: { fr: 'Boutique, ville, avis, date d’inscription.', en: 'Shop, city, reviews, sign-up date.' },
    paypal: { fr: 'Nom affiché et photo de la page PayPal.me.', en: 'Display name and picture of the PayPal.me page.' },
    pinterest: { fr: 'Tableaux, épingles personnelles (photos), site vérifié.', en: 'Boards, personal pins (photos), verified website.' }
  }
  const more = platform ? extra[platform]?.[lang] : undefined
  return more ? `${more} ${base}` : base
}

export default defineModule({
  id: 'social.profile_manual',
  name: { fr: 'Profil à consulter', en: 'Profile to check' },
  description: {
    fr: 'Comptes des plateformes que MASINT ne peut pas lire sans compte (Instagram, Facebook, LinkedIn, Pinterest, Threads, VK, Vinted...) : propose l’ouverture du profil dans « À vérifier », avec ce qu’il faut y relever, et complète l’URL du profil. Hors ligne.',
    en: 'Accounts on platforms MASINT cannot read without logging in (Instagram, Facebook, LinkedIn, Pinterest, Threads, VK, Vinted...): suggests opening the profile in "To review", with what to look for, and fills in the profile URL. Offline.'
  },
  category: 'social',
  inputTypes: ['account'],
  accepts: (input) => !!manualProfileUrl(input) && !hasDedicatedModule(input),
  async run(input, ctx) {
    const url = manualProfileUrl(input)
    if (!url) return {}
    const name = getPlatform(input.platform)?.name ?? (typeof input.data.site === 'string' ? input.data.site : ctx.lang === 'fr' ? 'du compte' : 'account')
    const out: ModuleOutput = {
      manual: [{ label: ctx.lang === 'fr' ? `Profil ${name}` : `${name} profile`, url, hint: profileHint(input.platform, ctx.lang) }]
    }
    // URL du profil absente de la fiche : on la complète.
    if (!(typeof input.data.url === 'string' && input.data.url)) out.properties = { url }
    return out
  }
})
