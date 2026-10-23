import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { accountEntity, compact, fetchRetry, httpFailure, md5, readJson, requireEmail, sha256, socialPlatform, tr } from './_lib'

// Profil public historique (plus riche : pseudos des comptes liés, liens, nom).
interface LegacyEntry {
  hash?: string
  profileUrl?: string
  preferredUsername?: string
  thumbnailUrl?: string
  displayName?: string
  name?: { givenName?: string; familyName?: string; formatted?: string } | []
  pronouns?: string
  aboutMe?: string
  currentLocation?: string
  job_title?: string
  company?: string
  emails?: Array<{ value?: string }>
  phoneNumbers?: Array<{ type?: string; value?: string }>
  accounts?: Array<{ domain?: string; display?: string; url?: string; username?: string; shortname?: string; name?: string }>
  urls?: Array<{ title?: string; value?: string }>
}

// API v3 (sans clé : profil réduit).
interface V3Profile {
  hash?: string
  display_name?: string
  profile_url?: string
  avatar_url?: string
  location?: string
  description?: string
  job_title?: string
  company?: string
  pronouns?: string
  verified_accounts?: Array<{ service_type?: string; service_label?: string; url?: string; is_hidden?: boolean }>
}

/** Nom d'utilisateur déduit d'une URL de profil (dernier segment du chemin). */
function userFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop()
    return seg ? decodeURIComponent(seg).replace(/^@/, '') : undefined
  } catch {
    return undefined
  }
}

export function parseGravatarLegacy(json: { entry?: LegacyEntry[] }, email: string, lang: 'fr' | 'en'): ModuleOutput {
  const e = json.entry?.[0]
  if (!e) throw new ModuleError('Gravatar : profil vide', 'other')
  const name = Array.isArray(e.name) ? undefined : e.name
  const fullName = name?.formatted || [name?.givenName, name?.familyName].filter(Boolean).join(' ')
  const username = e.preferredUsername || userFromUrl(e.profileUrl) || e.hash || email
  const entities: OutEntity[] = [
    accountEntity('gravatar', 'Gravatar', username, {
      ref: 'gravatar',
      data: compact({
        username,
        display_name: e.displayName,
        url: e.profileUrl,
        bio: e.aboutMe,
        location: e.currentLocation,
        job_title: e.job_title,
        company: e.company,
        pronouns: e.pronouns
      }),
      image: e.thumbnailUrl ? `${e.thumbnailUrl}?s=400` : undefined,
      linkLabel: tr({ lang }, 'profil Gravatar', 'Gravatar profile'),
      strength: 'same'
    })
  ]
  for (const a of e.accounts ?? []) {
    const label = a.username || a.display?.replace(/^@/, '') || userFromUrl(a.url)
    if (!label) continue
    const platform = socialPlatform(a.shortname, a.domain, a.name) ?? a.shortname ?? 'unknown'
    entities.push(
      accountEntity(platform, a.name || a.domain || 'Compte', label, {
        from: 'gravatar',
        data: compact({ username: a.username, url: a.url }),
        linkLabel: tr({ lang }, 'compte vérifié', 'verified account'),
        strength: 'same'
      })
    )
  }
  for (const u of e.urls ?? []) {
    if (!u.value) continue
    entities.push({ type: 'url', label: u.value, data: compact({ title: u.title }), from: 'gravatar', linkLabel: tr({ lang }, 'lien', 'link') })
  }
  for (const m of e.emails ?? []) {
    const v = m.value?.toLowerCase()
    if (!v || v === email) continue
    entities.push({ type: 'email', label: v, from: 'gravatar', linkLabel: tr({ lang }, 'autre email', 'other email') })
  }
  for (const p of e.phoneNumbers ?? []) {
    if (p.value) entities.push({ type: 'phone', label: p.value, from: 'gravatar', linkLabel: tr({ lang }, 'téléphone', 'phone') })
  }
  if (fullName) entities.push({ type: 'person', label: fullName, from: 'gravatar', linkLabel: tr({ lang }, 'nom', 'name') })
  return { found: true, entities, raw: e }
}

export function parseGravatarV3(json: V3Profile, email: string, lang: 'fr' | 'en'): ModuleOutput {
  const username = userFromUrl(json.profile_url) || json.hash || email
  const entities: OutEntity[] = [
    accountEntity('gravatar', 'Gravatar', username, {
      ref: 'gravatar',
      data: compact({
        username,
        display_name: json.display_name,
        url: json.profile_url,
        bio: json.description,
        location: json.location,
        job_title: json.job_title,
        company: json.company,
        pronouns: json.pronouns
      }),
      image: json.avatar_url ? `${json.avatar_url}?s=400` : undefined,
      linkLabel: tr({ lang }, 'profil Gravatar', 'Gravatar profile'),
      strength: 'same'
    })
  ]
  for (const a of json.verified_accounts ?? []) {
    const label = userFromUrl(a.url)
    if (!label || a.is_hidden) continue
    const platform = socialPlatform(a.service_type, a.service_label) ?? a.service_type ?? 'unknown'
    entities.push(
      accountEntity(platform, a.service_label || 'Compte', label, {
        from: 'gravatar',
        data: compact({ url: a.url }),
        linkLabel: tr({ lang }, 'compte vérifié', 'verified account'),
        strength: 'same'
      })
    )
  }
  return { found: true, entities, raw: json }
}

export default defineModule({
  id: 'email.gravatar',
  name: { fr: 'Profil Gravatar', en: 'Gravatar profile' },
  description: {
    fr: "Profil public Gravatar lié à l'adresse : pseudo, nom, photo, localisation, poste, comptes vérifiés (X, GitHub, LinkedIn...) et liens.",
    en: 'Public Gravatar profile linked to the address: username, name, photo, location, job, verified accounts (X, GitHub, LinkedIn...) and links.'
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://gravatar.com',
  async run(input, ctx) {
    const email = requireEmail(input)
    const hash = md5(email)
    const legacy = await fetchRetry(ctx, `https://en.gravatar.com/${hash}.json`, { headers: { accept: 'application/json' } })
    if (legacy.ok) {
      const json = await readJson<{ entry?: LegacyEntry[] }>(legacy, 'Gravatar').catch(() => null)
      if (json?.entry?.length) return parseGravatarLegacy(json, email, ctx.lang)
    } else if (legacy.status !== 404) {
      await legacy.body?.cancel().catch(() => undefined)
      // Ancien point d'accès indisponible : profil réduit via l'API v3.
      const v3 = await fetchRetry(ctx, `https://api.gravatar.com/v3/profiles/${sha256(email)}`, { headers: { accept: 'application/json' } })
      if (v3.ok) return parseGravatarV3(await readJson<V3Profile>(v3, 'Gravatar'), email, ctx.lang)
      if (v3.status !== 404) throw httpFailure('Gravatar', v3.status)
    } else {
      await legacy.body?.cancel().catch(() => undefined)
    }
    // Pas de profil public : une image peut tout de même être associée à l'adresse.
    const avatar = `https://gravatar.com/avatar/${hash}?d=404&s=400`
    const res = await ctx.fetch(avatar, { method: 'HEAD' })
    if (res.status === 404) return { found: false }
    if (!res.ok) throw httpFailure('Gravatar', res.status)
    return {
      found: true,
      entities: [
        accountEntity('gravatar', 'Gravatar', hash, {
          data: { url: `https://gravatar.com/avatar/${hash}`, bio: tr(ctx, 'Avatar sans profil public', 'Avatar without public profile') },
          image: avatar,
          linkLabel: tr(ctx, 'avatar Gravatar', 'Gravatar avatar'),
          strength: 'same'
        })
      ]
    }
  }
})
