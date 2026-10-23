import { defineModule, type OutEntity } from '@shared/modules'
import { acceptsPlatform, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

/** Client-ID public du site web de Twitch (utilisé sans compte par le lecteur web). */
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

// lookupType ALL : trouve aussi les comptes suspendus. Recherche par identifiant numérique
// (stable) quand il est connu, sinon par pseudo ; les panneaux de la chaîne portent ses liens.
const FIELDS = `id login displayName description createdAt updatedAt profileImageURL(width: 300)
  followers { totalCount } roles { isPartner isAffiliate isStaff }
  lastBroadcast { startedAt title } stream { createdAt }
  channel { socialMedias { name title url } }
  panels { ... on DefaultPanel { title linkURL description } }`
export const QUERY_BY_LOGIN = `query($login: String!) { user(login: $login, lookupType: ALL) { ${FIELDS} } }`
export const QUERY_BY_ID = `query($id: ID!) { user(id: $id, lookupType: ALL) { ${FIELDS} } }`

export interface TwitchUser {
  id: string
  login: string
  displayName?: string
  description?: string | null
  createdAt?: string
  updatedAt?: string
  profileImageURL?: string
  followers?: { totalCount?: number }
  roles?: { isPartner?: boolean | null; isAffiliate?: boolean | null; isStaff?: boolean | null }
  lastBroadcast?: { startedAt?: string | null; title?: string | null } | null
  stream?: { createdAt?: string } | null
  channel?: { socialMedias?: Array<{ name?: string; title?: string; url?: string }> | null } | null
  panels?: Array<{ title?: string | null; linkURL?: string | null; description?: string | null } | null> | null
}

/**
 * `previousLogin` : pseudo de l'entrée quand le compte, retrouvé par son identifiant stable,
 * en porte désormais un autre.
 */
export function parseTwitch(u: TwitchUser, lang: Lang, previousLogin?: string): Parsed {
  const role = u.roles?.isPartner ? 'partner' : u.roles?.isAffiliate ? 'affiliate' : undefined
  const panels = (u.panels ?? []).filter((p): p is NonNullable<typeof p> => !!p)
  const renamed = previousLogin && previousLogin.toLowerCase() !== u.login.toLowerCase() ? previousLogin : undefined
  const self = { platform: 'twitch', username: u.login }
  const children: OutEntity[] = linkedEntities({
    text: u.description ?? undefined,
    urls: (u.channel?.socialMedias ?? []).map((s) => s.url),
    lang,
    self
  })
  // Liens et textes des panneaux sous la vidéo, comme les autres liens de la bio.
  const panelLinks = linkedEntities({
    text: panels.map((p) => p.description ?? '').join('\n'),
    urls: panels.map((p) => p.linkURL),
    lang,
    self,
    textLabel: { fr: 'dans un panneau Twitch', en: 'in a Twitch panel' },
    linkLabel: { fr: 'lien d’un panneau Twitch', en: 'Twitch panel link' }
  })
  const known = new Set(children.map((c) => `${c.type}|${c.platform ?? ''}|${c.label.toLowerCase()}`))
  children.push(...panelLinks.filter((c) => !known.has(`${c.type}|${c.platform ?? ''}|${c.label.toLowerCase()}`)))
  if (renamed)
    children.push({
      type: 'username',
      label: u.login,
      linkLabel: lang === 'fr' ? 'pseudo actuel (même identifiant Twitch)' : 'current username (same Twitch ID)',
      strength: 'same'
    })
  return {
    profile: {
      username: u.login,
      url: `https://www.twitch.tv/${u.login}`,
      image: u.profileImageURL && !/user-default-pictures/.test(u.profileImageURL) ? u.profileImageURL : undefined,
      data: {
        user_id: u.id,
        display_name: u.displayName,
        bio: u.description ?? undefined,
        followers: u.followers?.totalCount,
        role,
        staff: u.roles?.isStaff || undefined,
        live: u.stream ? true : undefined,
        last_broadcast_title: u.lastBroadcast?.title ?? undefined,
        created_at: toIso(u.createdAt),
        updated_at: toIso(u.updatedAt),
        last_seen: toIso(u.stream?.createdAt ?? u.lastBroadcast?.startedAt ?? undefined),
        previous_usernames: renamed ? [renamed] : undefined
      }
    },
    children
  }
}

export default defineModule({
  id: 'social.twitch',
  name: { fr: 'Chaîne Twitch', en: 'Twitch channel' },
  description: {
    fr: 'Chaîne Twitch (API GraphQL publique du site) : nom, bio, date de création, abonnés, statut partenaire, dernière diffusion, réseaux sociaux et liens des panneaux de la chaîne. Un compte connu est relu par son identifiant stable, même renommé ou suspendu.',
    en: 'Twitch channel (public GraphQL API of the website): name, bio, creation date, followers, partner status, last broadcast, social links and channel panel links. A known account is read again by its stable ID, even if renamed or suspended.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('twitch'),
  homepage: 'https://www.twitch.tv',
  async run(input, ctx) {
    const login = requireUsername(input, /^\w{1,25}$/).toLowerCase()
    // Un compte déjà identifié est relu par son identifiant : il est retrouvé même renommé.
    const id = input.type === 'account' && /^\d{1,15}$/.test(String(input.data.user_id ?? '')) ? String(input.data.user_id) : null
    let res: { data?: { user: TwitchUser | null }; errors?: Array<{ message: string }> }
    try {
      res = await ctx.fetchJson('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'client-id': WEB_CLIENT_ID },
        json: id ? { query: QUERY_BY_ID, variables: { id } } : { query: QUERY_BY_LOGIN, variables: { login } }
      })
    } catch (e) {
      rethrow(e, 'Twitch')
    }
    if (res.errors?.length && !res.data?.user) throw new Error(`Twitch : ${res.errors[0].message}`)
    const user = res.data?.user
    if (!user) return notFound()
    const parsed = parseTwitch(user, ctx.lang, id ? login : undefined)
    return profileOutput(input, 'twitch', parsed.profile, parsed.children, user, ctx.lang)
  }
})
