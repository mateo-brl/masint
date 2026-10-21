import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { allSites, scanSites } from '../../src/main/modules/username/_sherlock'
import { LIVE, makeContext } from '../helpers/context'

const OUT = process.env.SCAN_OUT ?? '/tmp/scan.json'
const USERS = (process.env.SCAN_USERS ?? 'zq8x7v2kq9w1,torvalds').split(',')

describe.skipIf(!LIVE)('mesure', () => {
  it('scan', async () => {
    const ctx = makeContext()
    const sites = allSites()
    const out: Record<string, unknown> = {}
    for (const u of USERS) {
      const t = Date.now()
      out[u] = { ms: Date.now() - t, results: await scanSites(sites, u, ctx, { concurrency: 16, timeoutMs: 12000 }) }
      ;(out[u] as { ms: number }).ms = Date.now() - t
    }
    writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 900000)
})
