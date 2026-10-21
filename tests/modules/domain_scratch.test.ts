import { it } from 'vitest'
import dnsModule from '../../src/main/modules/domain/dnsRecords'
import rdap from '../../src/main/modules/domain/rdap'
import subdomains from '../../src/main/modules/domain/subdomains'
import hosting from '../../src/main/modules/domain/hosting'
import { modules as certs } from '../../src/main/modules/domain/certificates'
import { entity, makeContext } from '../helpers/context'
const short = (o: unknown) => JSON.stringify(o, null, 0).slice(0, 1500)
it('scratch', async () => {
  const ctx = makeContext()
  for (const [m, d] of [[dnsModule, 'lemonde.fr'], [rdap, 'o2switch.fr'], [hosting, 'lemonde.fr'], [hosting, 'masint.fr'], [subdomains, 'o2switch.fr'], [certs[0], 'www.o2switch.fr']] as const) {
    const out = await m.run(entity('domain', d), ctx).catch((e) => ({ error: String(e) }))
    require('node:fs').appendFileSync('/tmp/claude-0/-home-user-masint/81d04655-4d8d-5bae-ae07-527bfb24a465/scratchpad/out.txt', m.id + ' ' + d + ' ' + short({ ...out, raw: undefined }) + '\n')
  }
}, 300000)
