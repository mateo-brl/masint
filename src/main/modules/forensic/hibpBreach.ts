// Détails d'une fuite de données référencée par Have I Been Pwned (API publique, sans clé) :
// date, volume, données exposées, domaine du service.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, getJson, isoDate, stripHtml, tr } from '../misc/_util'

const API = 'https://haveibeenpwned.com/api/v3'

export interface HibpBreach {
  Name: string
  Title: string
  Domain?: string
  BreachDate?: string
  AddedDate?: string
  ModifiedDate?: string
  PwnCount?: number
  Description?: string
  LogoPath?: string
  DataClasses?: string[]
  IsVerified?: boolean
  IsFabricated?: boolean
  IsSensitive?: boolean
  IsRetired?: boolean
  IsSpamList?: boolean
  IsMalware?: boolean
  IsStealerLog?: boolean
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Fuite correspondant au libellé saisi (nom technique, titre ou domaine). */
export function findBreach(list: HibpBreach[], label: string): HibpBreach | null {
  const q = norm(label)
  if (!q) return null
  return (
    list.find((b) => norm(b.Name) === q) ??
    list.find((b) => norm(b.Title) === q) ??
    list.find((b) => !!b.Domain && norm(b.Domain) === q) ??
    null
  )
}

export function breachOutput(ctx: Pick<ModuleContext, 'lang'>, b: HibpBreach): ModuleOutput {
  const flags = [
    b.IsVerified === false ? tr(ctx, 'non vérifiée', 'unverified') : null,
    b.IsFabricated ? tr(ctx, 'fabriquée', 'fabricated') : null,
    b.IsSensitive ? tr(ctx, 'sensible', 'sensitive') : null,
    b.IsSpamList ? tr(ctx, 'liste de spam', 'spam list') : null,
    b.IsMalware ? 'malware' : null,
    b.IsStealerLog ? tr(ctx, 'journaux de stealer', 'stealer logs') : null,
    b.IsRetired ? tr(ctx, 'retirée', 'retired') : null
  ].filter((f): f is string => !!f)
  const properties = compact({
    name: b.Name,
    title: b.Title,
    breach_date: b.BreachDate ?? null,
    added_at: isoDate(b.AddedDate),
    records: b.PwnCount ?? null,
    data_classes: b.DataClasses ?? [],
    description: b.Description ? stripHtml(b.Description) : null,
    domain: b.Domain || null,
    verified: b.IsVerified ?? null,
    flags,
    url: `https://haveibeenpwned.com/Breach/${b.Name}`
  })
  const entities: OutEntity[] = []
  if (b.Domain) entities.push({ type: 'domain', label: b.Domain.toLowerCase(), linkLabel: tr(ctx, 'service touché', 'breached service') })
  return { properties, entities, raw: b }
}

export default defineModule({
  id: 'forensic.hibp_breach',
  name: { fr: 'Détails de la fuite (Have I Been Pwned)', en: 'Breach details (Have I Been Pwned)' },
  description: {
    fr: "Date, nombre de comptes, types de données exposées, description et domaine d'une fuite référencée par Have I Been Pwned (nom, titre ou domaine de la fuite).",
    en: 'Date, number of accounts, exposed data types, description and domain of a breach listed by Have I Been Pwned (breach name, title or domain).'
  },
  category: 'forensic',
  inputTypes: ['breach'],
  homepage: 'https://haveibeenpwned.com/PwnedWebsites',
  async run(input, ctx) {
    const label = input.label.trim()
    if (!label) return {}
    const direct = /^[A-Za-z0-9._-]+$/.test(label)
      ? await getJson<HibpBreach>(ctx, `${API}/breach/${encodeURIComponent(label)}`, 'Have I Been Pwned')
      : null
    if (direct) return breachOutput(ctx, direct)
    // Repli : liste complète des fuites (environ 1 Mo), comparée au titre ou au domaine.
    const all = await getJson<HibpBreach[]>(ctx, `${API}/breaches`, 'Have I Been Pwned', { timeoutMs: 30000 })
    const hit = findBreach(all ?? [], label)
    return hit ? breachOutput(ctx, hit) : {}
  }
})
