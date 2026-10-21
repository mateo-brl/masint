import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { acceptsPlatform, htmlToText, linkedEntities, notFound, profileOutput, rethrow, toIso, toNumber, usernameOf, type Lang, type Parsed } from './_lib'

/** Valeur d'une balise XML simple (avec ou sans CDATA). */
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`))
  const v = (m?.[1] ?? m?.[2] ?? '').trim()
  return v || undefined
}

export function parseSteam(xml: string, lang: Lang): Parsed | null {
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
  return {
    profile: {
      username: custom ?? id64,
      url: custom ? `https://steamcommunity.com/id/${custom}` : `https://steamcommunity.com/profiles/${id64}`,
      image: tag(profileXml, 'avatarFull'),
      data: {
        user_id: id64,
        display_name: tag(profileXml, 'steamID'),
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
    children: [...groups, ...linkedEntities({ text: bio, lang, self: { platform: 'steam', username: custom ?? id64 } })]
  }
}

export default defineModule({
  id: 'social.steam',
  name: { fr: 'Profil Steam', en: 'Steam profile' },
  description: {
    fr: 'Profil Steam (URL personnalisée ou SteamID64) : pseudo, vrai nom, localisation, résumé, date d’inscription, bannissements VAC et groupes.',
    en: 'Steam profile (custom URL or SteamID64): name, real name, location, summary, member since, VAC bans and groups.'
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
    const parsed = parseSteam(xml, ctx.lang)
    if (!parsed) return notFound()
    return profileOutput(input, 'steam', parsed.profile, parsed.children, parsed.profile.data, ctx.lang)
  }
})
