// Historique des pseudos X (Twitter) d'après memory.lol : archive publique qui associe
// l'identifiant numérique stable d'un compte aux pseudos observés, avec leurs dates.
// Trouve aussi le compte quand il a changé de pseudo (le profil courant répond alors 404).

import { defineModule, ModuleError, type ModuleOutput } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { previousNameEntities, spanText, type NameSpan } from './_history'
import { acceptsPlatform, compact, httpStatus, requireUsername, rethrow, type Lang } from './_lib'

const API = 'https://api.memory.lol/v1/tw'

export interface MemoryAccount {
  id: number
  id_str?: string
  /** Pseudo → [premier jour observé, dernier jour observé] (une seule date ou `null` possibles). */
  screen_names?: Record<string, string[] | null>
}

/** Comptes d'une réponse memory.lol (recherche par pseudo : `accounts`, par identifiant : un compte). */
export function memoryAccounts(json: { accounts?: MemoryAccount[] } | MemoryAccount | null): MemoryAccount[] {
  if (!json) return []
  if ('accounts' in json && Array.isArray(json.accounts)) return json.accounts
  return 'id' in json && json.screen_names && Object.keys(json.screen_names).length ? [json as MemoryAccount] : []
}

/** Pseudos d'un compte, du plus récent au plus ancien. */
export function memorySpans(a: MemoryAccount): NameSpan[] {
  return Object.entries(a.screen_names ?? {})
    .map(([name, dates]) => {
      const list = (dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort()
      return { name, from: list[0], until: list[list.length - 1] }
    })
    .sort((x, y) => (y.until ?? '').localeCompare(x.until ?? ''))
}

export function memoryLolOutput(accounts: MemoryAccount[], username: string, lang: Lang): ModuleOutput {
  if (!accounts.length) return { raw: { accounts: [] } }
  const several = accounts.length > 1
  const spans = accounts.map((a) => ({ id: a.id_str ?? String(a.id), spans: memorySpans(a) }))
  const others = spans.flatMap((a) => a.spans.filter((s) => s.name.toLowerCase() !== username.toLowerCase()).map((s) => s.name))
  const properties: Record<string, PropValue> = compact({
    x_user_ids: spans.map((a) => a.id),
    username_history: spans.flatMap((a) => a.spans.map((s) => (several ? `${spanText(s)} · id ${a.id}` : spanText(s)))),
    previous_usernames: [...new Set(others)]
  })
  const entities = spans.flatMap((a) =>
    previousNameEntities(a.spans, {
      current: username,
      service: 'X',
      source: 'memory.lol',
      lang,
      // Un même pseudo peut avoir servi à plusieurs comptes : l'identifiant lève l'ambiguïté.
      account: several ? `n° ${a.id}` : undefined
    })
  )
  return { properties, entities, raw: { accounts } }
}

export default defineModule({
  id: 'social.x_history',
  name: { fr: 'Historique des pseudos X (memory.lol)', en: 'X username history (memory.lol)' },
  description: {
    fr: "Interroge l'archive publique memory.lol : identifiant numérique stable du compte X et pseudos qu'il a portés, avec leurs dates. Les autres pseudos sont proposés à vérifier. L'accès public ne couvre que les observations récentes.",
    en: 'Queries the public memory.lol archive: stable numeric ID of the X account and the usernames it has used, with dates. Other usernames are offered for review. Public access only covers recent observations.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('x'),
  homepage: 'https://github.com/travisbrown/memory.lol',
  async run(input, ctx) {
    const username = requireUsername(input, /^\w{1,15}$/)
    const id = input.type === 'account' && /^\d{1,20}$/.test(String(input.data.user_id ?? '')) ? String(input.data.user_id) : null
    let json: { accounts?: MemoryAccount[] } | MemoryAccount | null
    try {
      json = await ctx.fetchJson(id ? `${API}/id/${id}` : `${API}/${encodeURIComponent(username)}`)
    } catch (e) {
      if (httpStatus(e) === 404) return {}
      if (httpStatus(e) === 429) throw new ModuleError('memory.lol : trop de requêtes, réessayer plus tard', 'rate_limited')
      rethrow(e, 'memory.lol')
    }
    return memoryLolOutput(memoryAccounts(json), username, ctx.lang)
  }
})
