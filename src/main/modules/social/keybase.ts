import { defineModule, type OutEntity } from '@shared/modules'
import { acceptsPlatform, compact, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

interface KeybaseProof {
  proof_type: string
  nametag: string
  service_url?: string
  human_url?: string
  state?: number
}

export interface KeybaseUser {
  id: string
  basics?: { username: string; ctime?: number; mtime?: number }
  profile?: { full_name?: string; location?: string; bio?: string } | null
  pictures?: { primary?: { url?: string } } | null
  proofs_summary?: { all?: KeybaseProof[] }
  cryptocurrency_addresses?: Record<string, Array<{ address: string }>>
  stellar?: { primary?: { account_id?: string } }
  devices?: Record<string, unknown>
}

const PROOF_PLATFORMS: Record<string, string> = {
  twitter: 'x',
  github: 'github',
  reddit: 'reddit',
  hackernews: 'hackernews',
  facebook: 'facebook',
  mastodon: 'mastodon'
}

const CHAINS: Record<string, string> = { bitcoin: 'bitcoin', zcash: 'zcash', ethereum: 'ethereum', litecoin: 'litecoin' }

export function parseKeybase(u: KeybaseUser, lang: Lang): Parsed {
  const proven = lang === 'fr' ? 'compte prouvé' : 'proven account'
  const children: OutEntity[] = []
  for (const p of u.proofs_summary?.all ?? []) {
    if (p.state !== undefined && p.state !== 1) continue
    const platform = PROOF_PLATFORMS[p.proof_type]
    if (platform) {
      children.push({ type: 'account', label: p.nametag, platform, data: compact({ username: p.nametag, url: p.service_url, proof_url: p.human_url }), linkLabel: proven })
    } else if (p.proof_type === 'dns') {
      children.push({ type: 'domain', label: p.nametag.toLowerCase(), linkLabel: lang === 'fr' ? 'domaine prouvé' : 'proven domain' })
    } else if (p.proof_type === 'generic_web_site' && p.service_url) {
      children.push({ type: 'url', label: p.service_url, data: { url: p.service_url }, linkLabel: lang === 'fr' ? 'site prouvé' : 'proven website' })
    } else if (p.service_url) {
      children.push({ type: 'url', label: p.service_url, data: { url: p.service_url, service: p.proof_type }, linkLabel: proven })
    }
  }
  for (const [chain, list] of Object.entries(u.cryptocurrency_addresses ?? {})) {
    for (const a of list) {
      children.push({
        type: 'crypto_wallet',
        label: a.address,
        platform: CHAINS[chain],
        data: { chain },
        linkLabel: lang === 'fr' ? 'adresse publiée' : 'published address'
      })
    }
  }
  const stellar = u.stellar?.primary?.account_id
  if (stellar) children.push({ type: 'crypto_wallet', label: stellar, data: { chain: 'stellar' }, linkLabel: lang === 'fr' ? 'portefeuille Stellar' : 'Stellar wallet' })
  const username = u.basics?.username ?? ''
  return {
    profile: {
      username,
      url: `https://keybase.io/${username}`,
      image: u.pictures?.primary?.url,
      data: {
        user_id: u.id,
        display_name: u.profile?.full_name,
        bio: u.profile?.bio,
        location: u.profile?.location,
        created_at: toIso(u.basics?.ctime),
        updated_at: toIso(u.basics?.mtime),
        devices: u.devices ? Object.keys(u.devices).length : undefined
      }
    },
    children: [...children, ...linkedEntities({ text: u.profile?.bio, lang, self: { platform: 'keybase', username } })]
  }
}

export default defineModule({
  id: 'social.keybase',
  name: { fr: 'Profil Keybase', en: 'Keybase profile' },
  description: {
    fr: 'Profil Keybase : nom, bio, localisation, comptes prouvés cryptographiquement (X, GitHub, Reddit, Hacker News...), domaines et adresses crypto publiées.',
    en: 'Keybase profile: name, bio, location, cryptographically proven accounts (X, GitHub, Reddit, Hacker News...), domains and published crypto addresses.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('keybase'),
  homepage: 'https://keybase.io/docs/api/1.0/call/user/lookup',
  async run(input, ctx) {
    const username = requireUsername(input, /^[a-z0-9_]{2,16}$/i)
    let res: { status?: { code: number; desc?: string }; them?: Array<KeybaseUser | null> }
    try {
      res = await ctx.fetchJson('https://keybase.io/_/api/1.0/user/lookup.json', {
        query: { usernames: username, fields: 'basics,profile,pictures,proofs_summary,cryptocurrency_addresses,stellar,devices' }
      })
    } catch (e) {
      rethrow(e, 'Keybase')
    }
    const user = res.them?.[0]
    if (!user?.basics) return notFound(res)
    const parsed = parseKeybase(user, ctx.lang)
    return profileOutput(input, 'keybase', parsed.profile, parsed.children, user, ctx.lang)
  }
})
