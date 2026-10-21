// roso.info : scan d'une adresse email (séquence du site /email/ :
// start -> meta -> modules en parallèle -> complete).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { creditsOf, isFatal, pool, redact, ROSO_COMMON, RosoClient, toRosoError, type Json } from './_client'
import {
  accountEntities,
  addGeneric,
  asArr,
  asObj,
  breachEntities,
  dropEmpty,
  intelxEntities,
  isEmail,
  isObj,
  pick,
  siteName,
  stealerEntities,
  str,
  uniq
} from './_parse'
import { EMAIL_NON_SILENT } from './_sites'

const PAGE = '/email/'
const POOL = 12
const SLOW: Record<string, number> = {
  gmail: 55000,
  googlemaps: 55000,
  yahoo: 55000,
  hudsonrock: 55000,
  dehashed: 55000,
  facebook: 55000,
  tiktok: 35000,
  thefork: 26000
}
const ALWAYS_ADDED = ['yahoo', 'protonmail', 'outlookcom', 'hotmailcom', 'outlookfr', 'hotmailfr']
const EXCLUDED = ['spoutible', 'bandlab', 'warthunder']

/** Liste finale des modules, filtrée comme le fait le site (silencieux, ACL, priorités). */
export function finalizeEmailModules(list: string[], nonSilent: string[], allowed: string[] | null): string[] {
  const allowSet = allowed ? new Set(allowed) : null
  const ok = (m: string): boolean => !allowSet || allowSet.has(m) || allowSet.has('*')
  const out = list
    .map((m) => m.trim())
    .filter((m) => m && m !== 'email' && m !== '*' && !nonSilent.includes(m) && !EXCLUDED.includes(m.toLowerCase()))
    .filter(ok)
  return uniq([...['googlemaps', 'gmail'].filter(ok), ...out])
}

async function moduleList(c: RosoClient, sessionId: string, allowed: string[] | null): Promise<string[]> {
  let nonSilent = EMAIL_NON_SILENT
  let list: string[] = []
  const meta = await c.get('/api/ec/email/meta', { sessionId, retries: 1, throwOnError: false, page: PAGE }).catch(() => null)
  if (meta?.ok) {
    const ns = asArr(meta.data.nonSilentModules).map(str).filter(Boolean)
    if (ns.length) nonSilent = ns
    const em = asArr(meta.data.enrichmentModules).map(str).filter(Boolean)
    if (em.length) list = [...em, ...ALWAYS_ADDED.filter((m) => !em.includes(m))]
  }
  if (!list.length) {
    const gs = await c.get('/api/gateway/graph/email-services.json', { retries: 1, throwOnError: false, page: PAGE }).catch(() => null)
    list = asArr(gs?.data.services)
      .map((s) => (isObj(s) ? pick(s, 'id', 'name') : str(s)))
      .filter(Boolean)
  }
  if (!list.length && allowed) list = allowed
  return finalizeEmailModules(list, nonSilent, allowed)
}

interface Found {
  mod: string
  data: Json
}

function foundEntities(found: Found[], email: string, lang: 'fr' | 'en'): { entities: OutEntity[]; breaches: string[] } {
  const entities: OutEntity[] = []
  const breaches: string[] = []
  for (const { mod, data } of found) {
    const m = mod.toLowerCase()
    const p = asObj(data.profile ?? data.data)
    if (m === 'hibp' || m === 'haveibeenpwned' || (Array.isArray(p.breaches) && !p.username)) {
      const list = breachEntities(p.breaches, '$input', lang)
      breaches.push(...list.map((b) => b.label))
      entities.push(...list)
      continue
    }
    if (m === 'intelx' || m === 'intelligencex') {
      entities.push(...intelxEntities(p.records, '$input', lang))
      continue
    }
    if (m === 'hudsonrock' || m === 'hudson') {
      entities.push(...stealerEntities(p.stealers, { refPrefix: 'hr', lang }))
      continue
    }
    if (m === 'whoxy' || m === 'whoisxml' || m === 'reversewhois') {
      for (const d of asArr(p.domains ?? p.otherDomains).slice(0, 100)) {
        const o = asObj(d)
        const name = (isObj(d) ? pick(o, 'domain_name', 'domain') : str(d)).toLowerCase()
        if (!name) continue
        entities.push({
          type: 'domain',
          label: name,
          data: dropEmpty({ registrar: pick(o, 'registrar') || undefined, created_at: pick(o, 'created') || undefined, expires_at: pick(o, 'expiry') || undefined }),
          linkLabel: lang === 'fr' ? 'WHOIS (titulaire)' : 'WHOIS (registrant)'
        })
      }
      continue
    }
    const ref = `acc_${m}`
    const out = accountEntities(p, { site: m, query: email, ref, lang })
    addGeneric(out, p, ref, email, lang)
    entities.push(...out)
  }
  return { entities, breaches: uniq(breaches) }
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.email',
  name: { fr: 'roso.info : email', en: 'roso.info: email' },
  description: {
    fr: "Scan complet roso.info d'une adresse email (comptes sur ~300 plateformes, fuites, infostealers, reverse WHOIS). Consomme des crédits roso.info.",
    en: 'Full roso.info scan of an email address (accounts on ~300 platforms, breaches, infostealers, reverse WHOIS). Consumes roso.info credits.'
  },
  inputTypes: ['email'],
  timeoutMs: 600_000,
  async run(input, ctx) {
    const email = input.label.trim().toLowerCase()
    if (!isEmail(email)) throw new ModuleError('Adresse email invalide', 'invalid_input')
    const c = new RosoClient(ctx, 'email')
    await c.checkMaintenance('email')

    const start = await c.launch('/api/gateway/email/start', { email }, { page: PAGE })
    const sessionId = str(start.sessionId)
    const allowed = start.allowedModules === null || start.allowedModules === undefined ? null : asArr(start.allowedModules).map(str)
    if (allowed && !allowed.length)
      throw new ModuleError(ctx.lang === 'fr' ? 'Aucun module email autorisé pour cette clé roso.info' : 'No email module allowed for this roso.info key', 'auth')

    const modules = await moduleList(c, sessionId, allowed)
    if (!modules.length) throw new ModuleError('roso.info : liste des modules email indisponible', 'unavailable')

    const found: Found[] = []
    const notFound: string[] = []
    const errors: Record<string, string> = {}
    await pool(modules, POOL, ctx.signal, async (mod) => {
      try {
        const res = await c.request(`/api/gateway/email/module/${encodeURIComponent(mod)}`, {
          method: 'POST',
          json: { email, sessionId },
          sessionId,
          timeoutMs: SLOW[mod] ?? 20000,
          retries: 1,
          throwOnError: false,
          page: PAGE
        })
        if (res.status === 401) throw toRosoError(401, res.data, 'email', ctx.lang)
        if (res.status === 404) return void notFound.push(mod)
        if (!res.ok) return void (errors[mod] = str(res.data.error) || str(res.data.message) || `HTTP ${res.status}`)
        const d = res.data
        if (d.success === true && d.exists === true) found.push({ mod, data: d })
        else if (d.exists === false || d.success === true) notFound.push(mod)
        else errors[mod] = str(d.error) || 'error'
      } catch (e) {
        if (isFatal(e)) throw e
        errors[mod] = e instanceof Error ? e.message : String(e)
      }
    })

    const { entities, breaches } = foundEntities(found, email, ctx.lang)

    // Archivage côté roso.info, comme le site en fin de scan (sans effet sur le résultat).
    if (sessionId && found.length) {
      const results = found.map(({ mod, data }) => {
        const p = asObj(data.profile)
        return {
          platform: mod,
          type: 'enrichment',
          profileUrl: str(p.profileUrl),
          displayName: pick(p, 'displayName', 'fullName', 'username', 'login'),
          username: pick(p, 'username', 'login'),
          avatar: str(p.avatar),
          exists: true,
          profile: p
        }
      })
      await c.post('/api/gateway/email/complete', { sessionId, results }, { retries: 0, throwOnError: false, page: PAGE }).catch(() => null)
    }

    return {
      properties: dropEmpty({
        roso_credits_left: creditsOf(start),
        roso_tier: str(start.tier) || undefined,
        roso_found_count: found.length,
        roso_modules_checked: modules.length,
        roso_errors: Object.keys(errors).length,
        roso_found_on: found.map((f) => siteName(f.mod)),
        breaches: breaches.length ? breaches : undefined
      }),
      entities,
      raw: redact(
        {
          start,
          modules: modules.length,
          found: Object.fromEntries(found.map((f) => [f.mod, f.data])),
          notFound,
          errors
        },
        c.key
      )
    }
  }
})
