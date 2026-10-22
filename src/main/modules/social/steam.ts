import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { previousNameEntities, type NameSpan } from './_history'
import { acceptsPlatform, htmlToText, linkedEntities, notFound, profileOutput, rethrow, toIso, toNumber, usernameOf, type Lang, type Parsed } from './_lib'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** « Aug 18, 2024 @ 1:23am » → `2024-08-18` ; Steam omet l'année en cours (« Mar 3 @ 9:22pm »). */
export function steamAliasDate(v: string | undefined, now = new Date()): string | undefined {
  const m = v?.trim().match(/^([A-Za-z]{3})\w*\s+(\d{1,2})(?:,\s*(\d{4}))?/)
  if (!m) return undefined
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return undefined
  const year = m[3] ?? String(now.getUTCFullYear())
  return `${year}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/**
 * Historique des noms affichés (`/ajaxaliases`), du plus récent au plus ancien : chaque nom est
 * adopté à sa date et utilisé jusqu'à l'adoption du suivant.
 */
export function steamAliasSpans(list: Array<{ newname?: string; timechanged?: string }>, now = new Date()): NameSpan[] {
  const spans: NameSpan[] = []
  let until: string | undefined
  for (const a of list) {
    const name = a.newname?.trim()
    const from = steamAliasDate(a.timechanged, now)
    if (name) spans.push({ name, from, until })
    until = from
  }
  return spans
}

/** Valeur d'une balise XML simple (avec ou sans CDATA). */
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`))
  const v = (m?.[1] ?? m?.[2] ?? '').trim()
  return v || undefined
}

export function parseSteam(xml: string, lang: Lang, aliases: NameSpan[] = []): Parsed | null {
  if (/<response>\s*<error>/.test(xml) || !/<profile>/.test(xml)) return null
  const profileXml = xml.split('<groups>')[0]
  const id64 = tag(profileXml, 'steamID64')
  if (!id64) return null
  const custom = tag(profileXml, 'customURL')
  const summary = tag(profileXml, 'summary')
  const bio = summary && summary !== 'No information given.' ? htmlToText(summary) : undefined
  const since = tag(profileXml, 'memberSince')
  const groups: OutEntity[] = []
  for (const g of (xml.split('<groups>')[1] ?? '').split('</group>').slice(0, 15)) {
    const name = tag(g, 'groupName')
    const slug = tag(g, 'groupURL')
    if (!name || !slug) continue
    groups.push({
      type: 'group',
      label: name,
      data: { url: `https://steamcommunity.com/groups/${slug}`, members: toNumber(tag(g, 'memberCount')) ?? null },
      linkLabel: g.includes('isPrimary="1"') ? (lang === 'fr' ? 'groupe Steam principal' : 'primary Steam group') : lang === 'fr' ? 'groupe Steam' : 'Steam group'
    })
  }
  const displayName = tag(profileXml, 'steamID')
  // Noms affichés précédents : le nom courant figure en tête de l'historique et en est exclu.
  const previous = aliases.filter((a) => a.name !== displayName)
  return {
    profile: {
      username: custom ?? id64,
      url: custom ? `https://steamcommunity.com/id/${custom}` : `https://steamcommunity.com/profiles/${id64}`,
      image: tag(profileXml, 'avatarFull'),
      data: {
        user_id: id64,
        display_name: displayName,
        previous_usernames: [...new Set(previous.map((a) => a.name))],
        real_name: tag(profileXml, 'realname'),
        location: tag(profileXml, 'location'),
        bio,
        headline: tag(profileXml, 'headline'),
        privacy: tag(profileXml, 'privacyState'),
        online_state: tag(profileXml, 'stateMessage'),
        vac_banned: tag(profileXml, 'vacBanned') === '1' || undefined,
        trade_ban: tag(profileXml, 'tradeBanState') !== 'None' ? tag(profileXml, 'tradeBanState') : undefined,
        limited_account: tag(profileXml, 'isLimitedAccount') === '1' || undefined,
        hours_played_2wk: toNumber(tag(profileXml, 'hoursPlayed2Wk')) || undefined,
        created_at: since ? toIso(`${since} 12:00 UTC`) : undefined
      }
    },
    children: [
      ...groups,
      ...linkedEntities({ text: bio, lang, self: { platform: 'steam', username: custom ?? id64 } }),
      ...previousNameEntities(previous, { service: 'Steam', source: lang === 'fr' ? 'historique des noms Steam' : 'Steam name history', lang })
    ]
  }
}

export default defineModule({
  id: 'social.steam',
  name: { fr: 'Profil Steam', en: 'Steam profile' },
  description: {
    fr: 'Profil Steam (URL personnalisée ou SteamID64) : pseudo, vrai nom, localisation, résumé, date d’inscription, bannissements VAC, groupes et anciens noms affichés (historique public, à vérifier).',
    en: 'Steam profile (custom URL or SteamID64): name, real name, location, summary, member since, VAC bans, groups and previous display names (public history, to review).'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('steam'),
  homepage: 'https://steamcommunity.com',
  async run(input, ctx) {
    const u = usernameOf(input)
    if (!/^[\w-]{2,32}$/.test(u)) throw new ModuleError('Identifiant Steam invalide', 'invalid_input')
    const path = /^7656119\d{10}$/.test(u) ? `profiles/${u}` : `id/${encodeURIComponent(u)}`
    let xml: string
    try {
      xml = await ctx.fetchText(`https://steamcommunity.com/${path}`, { query: { xml: 1 }, headers: { 'accept-language': 'en-US,en;q=0.9' } })
    } catch (e) {
      rethrow(e, 'Steam')
    }
    if (!/<steamID64>/.test(xml)) return notFound()
    // Historique public des noms affichés (lu avec l'identifiant stable SteamID64).
    const id64 = xml.match(/<steamID64>(\d+)<\/steamID64>/)?.[1]
    const aliases = id64
      ? await ctx
          .fetchJson<Array<{ newname?: string; timechanged?: string }>>(`https://steamcommunity.com/profiles/${id64}/ajaxaliases`, {
            headers: { 'accept-language': 'en-US,en;q=0.9' }
          })
          .catch(() => [])
      : []
    const parsed = parseSteam(xml, ctx.lang, Array.isArray(aliases) ? steamAliasSpans(aliases) : [])
    if (!parsed) return notFound()
    return profileOutput(input, 'steam', parsed.profile, parsed.children, parsed.profile.data, ctx.lang)
  }
})
