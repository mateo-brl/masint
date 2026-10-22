import { defineModule, type OutEntity } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, type Lang, type Parsed } from './_lib'

export interface GravatarEntry {
  hash?: string
  requestHash?: string
  profileUrl?: string
  preferredUsername?: string
  thumbnailUrl?: string
  photos?: Array<{ value: string; type?: string }>
  displayName?: string
  name?: { givenName?: string; familyName?: string; formatted?: string } | []
  pronouns?: string
  aboutMe?: string
  currentLocation?: string
  job_title?: string
  company?: string
  emails?: Array<{ value: string; primary?: string }>
  phoneNumbers?: Array<{ value: string; type?: string }>
  urls?: Array<{ value: string; title?: string }>
  accounts?: Array<{ url?: string; username?: string; shortname?: string; verified?: boolean | string; is_hidden?: boolean }>
  contactInfo?: Array<{ type: string; value: string }>
  currency?: Array<{ type: string; value: string }>
}

const CHAINS: Record<string, string> = { bitcoin: 'bitcoin', ethereum: 'ethereum', litecoin: 'litecoin', dogecoin: 'dogecoin', monero: 'monero', solana: 'solana' }

export function parseGravatar(e: GravatarEntry, lang: Lang): Parsed {
  const username = e.preferredUsername ?? e.requestHash ?? ''
  const name = Array.isArray(e.name) ? undefined : e.name
  const contactUrls = (e.contactInfo ?? []).filter((c) => /^https?:/.test(c.value)).map((c) => c.value)
  const contactEmails = (e.contactInfo ?? []).filter((c) => c.type === 'email').map((c) => c.value)
  const children: OutEntity[] = [
    // Comptes vérifiés par Gravatar : même identité ; liens et contacts : déclarés.
    ...linkedEntities({
      text: e.aboutMe,
      sameUrls: (e.accounts ?? []).filter((a) => !a.is_hidden).map((a) => a.url),
      urls: [...(e.urls ?? []).map((u) => u.value), ...contactUrls],
      emails: [...(e.emails ?? []).map((m) => m.value), ...contactEmails],
      lang,
      self: { platform: 'gravatar', username }
    }),
    ...[...(e.phoneNumbers ?? []), ...(e.contactInfo ?? []).filter((c) => /phone|cell|mobile/.test(c.type))].map(
      (p): OutEntity => ({ type: 'phone', label: p.value, linkLabel: lang === 'fr' ? 'téléphone (Gravatar)' : 'phone (Gravatar)' })
    ),
    ...(e.currency ?? []).map(
      (c): OutEntity => ({
        type: 'crypto_wallet',
        label: c.value,
        platform: CHAINS[c.type.toLowerCase()],
        data: { chain: c.type },
        linkLabel: lang === 'fr' ? 'portefeuille (Gravatar)' : 'wallet (Gravatar)',
        strength: 'declared'
      })
    )
  ]
  return {
    profile: {
      username,
      url: e.profileUrl ?? `https://gravatar.com/${username}`,
      image: e.thumbnailUrl ? `${e.thumbnailUrl.split('?')[0]}?s=400` : undefined,
      data: {
        display_name: e.displayName,
        first_name: name?.givenName,
        last_name: name?.familyName,
        bio: e.aboutMe,
        location: e.currentLocation,
        occupation: e.job_title,
        company: e.company,
        pronouns: e.pronouns,
        // SHA-256 de l'email principal : pivot avec les modules email.
        email_hash: e.hash,
        photo_hashes: (e.photos ?? []).map((p) => p.value.match(/avatar\/([a-f0-9]{32,64})/)?.[1]).filter((h): h is string => !!h)
      }
    },
    children
  }
}

export default defineModule({
  id: 'social.gravatar',
  name: { fr: 'Profil Gravatar', en: 'Gravatar profile' },
  description: {
    fr: 'Profil Gravatar par pseudo : nom, bio, localisation, métier, emails et téléphones publics, comptes vérifiés, liens, portefeuilles crypto et empreinte de l’email.',
    en: 'Gravatar profile by username: name, bio, location, job, public emails and phones, verified accounts, links, crypto wallets and email hash.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('gravatar'),
  homepage: 'https://gravatar.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.-]{2,64}$/)
    let res: { entry?: GravatarEntry[] }
    try {
      res = await ctx.fetchJson(`https://en.gravatar.com/${encodeURIComponent(username)}.json`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Gravatar')
    }
    const entry = res.entry?.[0]
    if (!entry) return notFound(res)
    const parsed = parseGravatar(entry, ctx.lang)
    return profileOutput(input, 'gravatar', parsed.profile, parsed.children, entry, ctx.lang)
  }
})
