import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, fetchRetry, httpFailure, readJson, requireEmail, tr } from './_lib'

export interface HibpBreach {
  Name?: string
  Title?: string
  Domain?: string
  BreachDate?: string
  AddedDate?: string
  PwnCount?: number
  Description?: string
  DataClasses?: string[]
  IsVerified?: boolean
  IsSensitive?: boolean
  IsSpamList?: boolean
  IsMalware?: boolean
  IsStealerLog?: boolean
}

export interface HibpPaste {
  Source?: string
  Id?: string
  Title?: string | null
  Date?: string | null
  EmailCount?: number
}

const PASTE_URLS: Record<string, string> = {
  Pastebin: 'https://pastebin.com/',
  Ghostbin: 'https://ghostbin.com/paste/',
  JustPaste: 'https://justpaste.it/'
}

const stripHtml = (s?: string): string | undefined =>
  s
    ?.replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .trim()

export function parseHibp(breaches: HibpBreach[], pastes: HibpPaste[], lang: 'fr' | 'en'): ModuleOutput {
  if (!breaches.length && !pastes.length) return {}
  const entities: OutEntity[] = breaches
    .filter((b) => b.Name)
    .map((b) => ({
      type: 'breach',
      label: b.Title || b.Name!,
      data: compact({
        breach_date: b.BreachDate,
        added_at: b.AddedDate,
        records: b.PwnCount,
        data_classes: b.DataClasses ?? [],
        description: stripHtml(b.Description),
        domain: b.Domain,
        verified: b.IsVerified,
        sensitive: b.IsSensitive || undefined,
        stealer_log: b.IsStealerLog || undefined,
        spam_list: b.IsSpamList || undefined
      }),
      linkLabel: tr({ lang }, 'exposé dans', 'exposed in')
    }))
  for (const p of pastes) {
    if (!p.Source || !p.Id) continue
    const base = PASTE_URLS[p.Source]
    entities.push({
      type: 'document',
      label: `${p.Source} ${p.Id}`,
      data: compact({
        url: base ? base + p.Id : undefined,
        title: p.Title ?? undefined,
        date: p.Date ?? undefined,
        email_count: p.EmailCount
      }),
      linkLabel: tr({ lang }, 'cité dans un paste', 'found in a paste')
    })
  }
  return {
    properties: compact({
      breaches: breaches.map((b) => b.Title || b.Name || '').filter(Boolean),
      hibp_breach_count: breaches.length,
      hibp_paste_count: pastes.length || undefined
    }),
    entities,
    raw: { breaches: breaches.map((b) => b.Name), pastes }
  }
}

export default defineModule({
  id: 'email.hibp',
  name: { fr: 'Have I Been Pwned', en: 'Have I Been Pwned' },
  description: {
    fr: "Fuites de données et pastes publics contenant l'adresse, selon Have I Been Pwned (clé API payante) : date, volume et données exposées.",
    en: 'Data breaches and public pastes containing the address, from Have I Been Pwned (paid API key): date, size and exposed data.'
  },
  category: 'email',
  inputTypes: ['email'],
  keys: [{ id: 'hibp', label: 'Have I Been Pwned API key', url: 'https://haveibeenpwned.com/API/Key' }],
  homepage: 'https://haveibeenpwned.com',
  async run(input, ctx) {
    const email = requireEmail(input)
    const key = ctx.key('hibp')
    if (!key) throw new ModuleError('Clé Have I Been Pwned manquante', 'auth')
    const headers = { 'hibp-api-key': key, accept: 'application/json' }
    const call = async <T>(path: string, query?: Record<string, string>): Promise<T[]> => {
      const url = `https://haveibeenpwned.com/api/v3/${path}/${encodeURIComponent(email)}`
      const res = await fetchRetry(ctx, url, { headers, query }, { retries: 2 })
      if (res.status === 404) return []
      if (res.status === 401) throw new ModuleError('Have I Been Pwned : clé API refusée', 'auth')
      if (!res.ok) throw httpFailure('Have I Been Pwned', res.status)
      return readJson<T[]>(res, 'Have I Been Pwned')
    }
    const breaches = await call<HibpBreach>('breachedaccount', { truncateResponse: 'false' })
    // Les pastes sont un bonus : un refus (offre sans pastes, quota) ne doit pas masquer les fuites.
    const pastes = await call<HibpPaste>('pasteaccount').catch(() => [] as HibpPaste[])
    return parseHibp(breaches, pastes, ctx.lang)
  }
})
