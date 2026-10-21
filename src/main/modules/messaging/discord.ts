import { defineModule, ModuleError, type InputEntity, type OutEntity } from '@shared/modules'
import { compact, httpStatus, linkedEntities, rethrow, type Lang } from '../social/_lib'

const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/([A-Za-z0-9-]{2,40})/i

/** Code d'invitation contenu dans le libellé ou l'URL de l'entité. */
export function inviteCode(input: Pick<InputEntity, 'label' | 'data'>): string | null {
  const candidates = [input.label, typeof input.data.url === 'string' ? input.data.url : '']
  for (const c of candidates) {
    const m = c.match(INVITE_RE)
    if (m) return m[1]
  }
  return null
}

/** Date de création encodée dans un identifiant Discord (snowflake). */
export function snowflakeDate(id: string): string | undefined {
  if (!/^\d{15,20}$/.test(id)) return undefined
  const ms = Number(BigInt(id) >> 22n) + 1420070400000
  return new Date(ms).toISOString()
}

export interface DiscordInvite {
  code: string
  expires_at?: string | null
  guild?: {
    id: string
    name: string
    description?: string | null
    icon?: string | null
    vanity_url_code?: string | null
    verification_level?: number
    nsfw?: boolean
    nsfw_level?: number
    features?: string[]
  }
  channel?: { id: string; name?: string; type?: number }
  inviter?: { id: string; username: string; global_name?: string | null; avatar?: string | null; clan?: { tag?: string } | null }
  approximate_member_count?: number
  approximate_presence_count?: number
  profile?: { tag?: string | null }
}

export function parseInvite(inv: DiscordInvite, lang: Lang): OutEntity[] {
  const g = inv.guild
  const out: OutEntity[] = []
  const inviteUrl = `https://discord.gg/${inv.code}`
  if (g) {
    const icon = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith('a_') ? 'gif' : 'png'}?size=256` : undefined
    out.push({
      ref: 'guild',
      type: 'group',
      label: g.name,
      platform: 'discord',
      image: icon,
      data: compact({
        url: inviteUrl,
        guild_id: g.id,
        description: g.description ?? undefined,
        members: inv.approximate_member_count,
        online: inv.approximate_presence_count,
        vanity_url: g.vanity_url_code ? `https://discord.gg/${g.vanity_url_code}` : undefined,
        invite_channel: inv.channel?.name,
        verification_level: g.verification_level,
        nsfw: g.nsfw || (g.nsfw_level ?? 0) > 0 || undefined,
        community: g.features?.includes('COMMUNITY') || undefined,
        guild_tag: inv.profile?.tag ?? undefined,
        invite_expires_at: inv.expires_at ?? undefined,
        created_at: snowflakeDate(g.id)
      }),
      linkLabel: lang === 'fr' ? 'serveur Discord' : 'Discord server'
    })
    out.push(...linkedEntities({ text: g.description ?? undefined, lang }).map((e) => ({ ...e, from: 'guild' })))
  }
  const u = inv.inviter
  if (u) {
    out.push({
      type: 'account',
      label: u.username,
      platform: 'discord',
      image: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256` : undefined,
      data: compact({
        username: u.username,
        user_id: u.id,
        display_name: u.global_name ?? undefined,
        url: `https://discord.com/users/${u.id}`,
        created_at: snowflakeDate(u.id)
      }),
      from: g ? 'guild' : undefined,
      linkLabel: lang === 'fr' ? 'invitation créée par' : 'invite created by'
    })
  }
  return out
}

export default defineModule({
  id: 'messaging.discord_invite',
  name: { fr: 'Invitation Discord', en: 'Discord invite' },
  description: {
    fr: 'Résout un lien d’invitation Discord (discord.gg/...) sans rejoindre le serveur : nom, description, nombre de membres et en ligne, date de création du serveur et compte qui a créé l’invitation.',
    en: 'Resolves a Discord invite link (discord.gg/...) without joining the server: name, description, member and online counts, server creation date and the account that created the invite.'
  },
  category: 'messaging',
  inputTypes: ['url', 'keyword'],
  accepts: (input) => inviteCode(input) !== null,
  homepage: 'https://discord.com/developers/docs/resources/invite#get-invite',
  async run(input, ctx) {
    const code = inviteCode(input)
    if (!code) throw new ModuleError('Lien d’invitation Discord introuvable', 'invalid_input')
    let inv: DiscordInvite
    try {
      inv = await ctx.fetchJson<DiscordInvite>(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}`, {
        query: { with_counts: 'true', with_expiration: 'true' }
      })
    } catch (e) {
      if (httpStatus(e) === 404) return { found: false, properties: { invite_valid: false } }
      rethrow(e, 'Discord')
    }
    return { found: true, properties: { invite_valid: true }, entities: parseInvite(inv, ctx.lang), raw: { ...inv, guild: inv.guild && { ...inv.guild, features: inv.guild.features?.length } } }
  }
})
