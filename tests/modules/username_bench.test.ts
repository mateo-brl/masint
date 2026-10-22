// Banc de faux positifs des sites de pseudo : contrôle témoin (pseudo témoin public de la base,
// qui doit être trouvé, et pseudo aléatoire, qui ne doit pas l'être) sur un palier entier.
// Réseau requis, jamais en CI :
//   BENCH=1 npx vitest run tests/modules/username_bench.test.ts
//   BENCH=extended BENCH_OUT=/chemin/resultat.json npx vitest run tests/modules/username_bench.test.ts
// Les sites en faux positif vont dans la liste noire (BLACKLIST de _sherlock.ts ou
// MAIGRET_BLACKLIST de _catalog.ts), avec le bilan dans resources/data/README.md.

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { tierSites, type Tier } from '../../src/main/modules/username/_catalog'
import { selfCheck } from '../../src/main/modules/username/_health'
import { makeContext } from '../helpers/context'

const BENCH = process.env.BENCH
const tier: Tier = BENCH === 'extended' || BENCH === 'nsfw' ? BENCH : 'essential'

describe.skipIf(!BENCH)('banc de faux positifs', () => {
  it(`contrôle témoin du palier ${tier}`, async () => {
    const sites = tierSites(tier)
    const started = Date.now()
    const results = await selfCheck(sites, makeContext(), { concurrency: 16, timeoutMs: 12000 })
    const count: Record<string, number> = {}
    for (const r of results) count[r.verdict] = (count[r.verdict] ?? 0) + 1
    const pick = (v: string): string[] => results.filter((r) => r.verdict === v).map((r) => r.id)
    const report = {
      tier,
      sites: sites.length,
      duration_ms: Date.now() - started,
      count,
      false_positive: pick('false_positive'),
      missed: pick('missed'),
      inconclusive: results.filter((r) => r.verdict === 'inconclusive').map((r) => `${r.id} (${r.claimed}/${r.random}${r.detail ? `, ${r.detail}` : ''})`)
    }
    if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify({ report, results }, null, 2))
    console.log(JSON.stringify({ ...report, inconclusive: report.inconclusive.length }, null, 2))
    expect(results.length).toBe(sites.length)
  }, 3_600_000)
})
