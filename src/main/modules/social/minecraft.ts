import { defineModule } from '@shared/modules'
import { acceptsPlatform, httpStatus, notFound, profileOutput, requireUsername, rethrow } from './_lib'

/** UUID Mojang (32 hexadécimaux) au format avec tirets. */
export function dashedUuid(id: string): string {
  return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

export default defineModule({
  id: 'social.minecraft',
  name: { fr: 'Compte Minecraft', en: 'Minecraft account' },
  description: {
    fr: 'Vérifie le pseudo Minecraft Java auprès de l’API Mojang et récupère l’UUID du compte (pivot vers NameMC et les serveurs).',
    en: 'Checks the Minecraft Java username against the Mojang API and gets the account UUID (pivot to NameMC and servers).'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('minecraft'),
  homepage: 'https://minecraft.wiki/w/Mojang_API',
  async run(input, ctx) {
    const username = requireUsername(input, /^\w{3,16}$/)
    let res: { id?: string; name?: string } | null
    try {
      const r = await ctx.fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`, { headers: { accept: 'application/json' } })
      if (r.status === 204 || r.status === 404) return notFound()
      const text = await r.text()
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
      res = JSON.parse(text) as { id?: string; name?: string }
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Mojang')
    }
    if (!res?.id || !res.name) return notFound(res)
    return profileOutput(
      input,
      'minecraft',
      {
        username: res.name,
        url: `https://namemc.com/profile/${res.name}`,
        data: { user_id: dashedUuid(res.id), skin_url: `https://mc-heads.net/body/${res.id}` }
      },
      [],
      res,
      ctx.lang
    )
  }
})
