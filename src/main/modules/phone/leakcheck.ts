import { defineModule } from '@shared/modules'
import { fetchRetry, httpFailure, readJson } from '../email/_lib'
import { parseLeakcheck, type LeakcheckResponse } from '../email/leakcheck'
import { toE164 } from './_phone'

export default defineModule({
  id: 'phone.leakcheck',
  name: { fr: 'Fuites de données (LeakCheck)', en: 'Data breaches (LeakCheck)' },
  description: {
    fr: "Bases de données piratées contenant le numéro, via l'API publique gratuite de LeakCheck : nom de la source, date et types de champs exposés. Le type de recherche est deviné par le service.",
    en: "Leaked databases containing the number, via LeakCheck's free public API: source name, date and exposed field types. The search type is guessed by the service."
  },
  category: 'phone',
  inputTypes: ['phone'],
  homepage: 'https://leakcheck.io',
  // L'API publique ne documente que l'email et le pseudo ; les numéros semblent reconnus.
  experimental: true,
  async run(input, ctx) {
    const digits = toE164(input).slice(1)
    const res = await fetchRetry(ctx, 'https://leakcheck.io/api/public', { query: { check: digits } }, { retries: 2 })
    if (!res.ok && res.status !== 400 && res.status !== 404) throw httpFailure('LeakCheck', res.status)
    return parseLeakcheck(await readJson<LeakcheckResponse>(res, 'LeakCheck'), ctx.lang)
  }
})
