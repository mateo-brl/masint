// Listes de blocage publiques (ip.blocklists) : formats, index des plages, cache partagé
// entre les lancements et tolérance aux listes qui ne répondent pas.

import { beforeEach, describe, expect, it, type TestContext } from 'vitest'
import { ModuleError } from '@shared/modules'
import blocklists, {
  canonicalIp,
  cidrBounds,
  exactList,
  ipsumList,
  loadList,
  LISTS,
  netsetList,
  RangeIndex,
  resetBlocklistCache,
  spamhausAsnDrop,
  spamhausDrop
} from '../../src/main/modules/ip/blocklists'
import { fakeContext, fixture } from '../fixtures/domain/_fake'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const list = (name: string): string => fixture(`ip/blocklists/${name}`)

/** Toutes les listes servies depuis les fixtures (extraits réels, adresses de test RFC 5737 ajoutées). */
const routes = (): Record<string, object | string> => ({
  'https://www.spamhaus.org/drop/drop_v4.json': list('drop_v4.json'),
  'https://www.spamhaus.org/drop/drop_v6.json': list('drop_v6.json'),
  'https://www.spamhaus.org/drop/asndrop.json': list('asndrop.json'),
  'https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt': list('ipsum.txt'),
  'https://feodotracker.abuse.ch/downloads/ipblocklist.txt': list('feodo.txt'),
  'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset': list('firehol_level1.netset'),
  'https://lists.blocklist.de/lists/all.txt': list('blocklist_de.txt'),
  'https://cinsscore.com/list/ci-badguys.txt': list('cins.txt'),
  'https://isc.sans.edu/api/ip/203.0.113.7': {
    ip: { number: '203.0.113.7', count: 120, attacks: 15, mindate: '2026-09-04', maxdate: '2026-10-21', comment: null, threatfeeds: { ciarmy: { firstseen: '2026-09-04', lastseen: '2026-10-21' } } }
  }
})

beforeEach(() => resetBlocklistCache())

describe('ip.blocklists : formats', () => {
  it('calcule les bornes des blocs CIDR', () => {
    expect(cidrBounds('1.10.16.0/20')).toEqual({ v: 4, start: 17436672, end: 17440767 })
    expect(cidrBounds('198.51.100.99')).toMatchObject({ v: 4, start: 3325256803, end: 3325256803 })
    const v6 = cidrBounds('2001:678:254::/48')
    expect(v6?.v).toBe(6)
    expect(cidrBounds('1.2.3.4/33')).toBeNull()
    expect(canonicalIp('2001:DB8::1')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
  })

  it('trouve une adresse dans des plages imbriquées, en O(log n)', () => {
    const idx = new RangeIndex<number>([
      { start: 10, end: 1000, label: 'large' },
      { start: 20, end: 30, label: 'petit' },
      { start: 2000, end: 3000, label: 'autre' }
    ])
    expect(idx.find(25)).toBe('petit')
    // Après le petit bloc, toujours couvert par le grand bloc qui commence avant.
    expect(idx.find(500)).toBe('large')
    expect(idx.find(1500)).toBeNull()
    expect(idx.find(2999)).toBe('autre')
    expect(idx.find(5)).toBeNull()
  })

  it('lit Spamhaus DROP et ASN-DROP (JSON par ligne, ligne de métadonnées ignorée)', () => {
    const drop = spamhausDrop(list('drop_v4.json'))
    expect(drop.size).toBe(4)
    expect(drop.lookup('1.10.16.5', null)).toBe('SBL256894')
    expect(drop.lookup('8.8.8.8', null)).toBeNull()
    const v6 = spamhausDrop(list('drop_v6.json'))
    expect(v6.lookup('2001:678:254::1', null)).toMatch(/^SBL\d+$/)
    const asn = spamhausAsnDrop(list('asndrop.json'))
    expect(asn.lookup('1.2.3.4', 245)).toBe('AS245 PRC-AS')
    expect(asn.lookup('1.2.3.4', 15169)).toBeNull()
  })

  it('lit IPsum, FireHOL et les listes d’adresses', () => {
    const ipsum = ipsumList(list('ipsum.txt'))
    expect(ipsum.score('203.0.113.7')).toBe(3)
    expect(ipsum.score('198.51.100.1')).toBeNull()
    const firehol = netsetList(list('firehol_level1.netset'))
    expect(firehol.lookup('5.188.10.7', null)).toBe('')
    expect(firehol.lookup('5.200.0.1', null)).toBe('')
    expect(firehol.lookup('6.0.0.1', null)).toBeNull()
    const bl = exactList(list('blocklist_de.txt'))
    expect(bl.lookup('2001:db8::1', null)).toBe('')
    expect(bl.lookup('203.0.113.7', null)).toBe('')
    expect(exactList(list('feodo.txt')).size).toBeGreaterThan(0)
  })
})

describe('ip.blocklists : module', () => {
  it('liste les sources qui citent l’IP, avec score IPsum et signalements DShield', async () => {
    const ctx = fakeContext({ routes: routes() })
    const out = await blocklists.run(entity('ip', '203.0.113.7'), ctx)
    expect(out.entities).toBeUndefined()
    expect(out.properties).toMatchObject({
      listed_in: ['IPsum', 'blocklist.de', 'CINS Army'],
      listed_count: 3,
      ipsum_score: 3,
      dshield_reports: 120,
      dshield_targets: 15,
      dshield_first_seen: '2026-09-04',
      dshield_last_seen: '2026-10-21',
      dshield_feeds: ['ciarmy']
    })
  })

  it('reconnaît un bloc Spamhaus DROP et l’ASN connu d’un autre module', async () => {
    const ctx = fakeContext({ routes: routes() })
    const out = await blocklists.run(entity('ip', '1.10.16.5', { data: { asn: 'AS245' } }), ctx)
    expect(out.properties?.listed_in).toEqual(['Spamhaus DROP (SBL256894)', 'Spamhaus ASN-DROP', 'FireHOL level1'])
    expect(out.properties).toMatchObject({ spamhaus_drop: 'SBL256894', spamhaus_asn_drop: 'AS245 PRC-AS', listed_count: 3 })
  })

  it('résout l’ASN par Team Cymru quand il est inconnu', async () => {
    const ctx = fakeContext({ routes: routes(), dns: { '5.16.10.1.origin.asn.cymru.com|TXT': ['245 | 1.10.16.0/20 | US | arin | 2010-01-01'] } })
    const out = await blocklists.run(entity('ip', '1.10.16.5'), ctx)
    expect(out.properties?.spamhaus_asn_drop).toBe('AS245 PRC-AS')
  })

  it('télécharge chaque liste une seule fois par période (cache partagé)', async () => {
    const ctx = fakeContext({ routes: routes() })
    await blocklists.run(entity('ip', '203.0.113.7'), ctx)
    const first = ctx.requests.filter((u) => !u.includes('isc.sans.edu')).length
    expect(first).toBe(LISTS.filter((l) => l.covers.includes(4) && !l.byAsn).length)
    await blocklists.run(entity('ip', '198.51.100.42'), ctx)
    expect(ctx.requests.filter((u) => !u.includes('isc.sans.edu')).length).toBe(first)
    // Au-delà de 24 heures, la liste est retéléchargée.
    const def = LISTS.find((l) => l.id === 'cins')!
    await loadList(ctx, def, Date.now() + 25 * 3600_000)
    expect(ctx.requests.filter((u) => u.includes('cinsscore')).length).toBe(2)
  })

  it('tolère une liste qui ne répond pas et le signale', async () => {
    const ctx = fakeContext({
      routes: {
        ...routes(),
        'https://feodotracker.abuse.ch/downloads/ipblocklist.txt': { status: 503, body: 'down' },
        'https://cinsscore.com/list/ci-badguys.txt': '<html>maintenance</html>'
      }
    })
    const out = await blocklists.run(entity('ip', '198.51.100.42'), ctx)
    expect(out.properties).toMatchObject({ listed_in: ['blocklist.de'], blocklists_unavailable: ['abuse.ch Feodo Tracker', 'CINS Army'] })
    // Une liste en échec n'est pas redemandée aussitôt.
    await blocklists.run(entity('ip', '198.51.100.42'), ctx)
    expect(ctx.requests.filter((u) => u.includes('feodotracker')).length).toBe(1)
  })

  it('ne consulte que les listes IPv6 pour une adresse IPv6, sans DShield', async () => {
    const ctx = fakeContext({ routes: routes() })
    const out = await blocklists.run(entity('ip', '2001:678:254::10'), ctx)
    expect(out.properties?.listed_in).toEqual(['Spamhaus DROP (SBL697648)'])
    expect(ctx.requests.some((u) => u.includes('ipsum') || u.includes('isc.sans.edu'))).toBe(false)
  })

  it('ignore les adresses privées et signale une panne totale', async () => {
    expect(await blocklists.run(entity('ip', '192.168.1.10'), fakeContext({ routes: routes() }))).toEqual({})
    await expect(blocklists.run(entity('ip', '198.51.100.42'), fakeContext({ routes: {} }))).rejects.toThrow(ModuleError)
  })

  it('une adresse absente de toutes les listes : listed_count à 0', async () => {
    const out = await blocklists.run(entity('ip', '198.51.100.200'), fakeContext({ routes: routes() }))
    expect(out.properties).toEqual({ listed_count: 0 })
  })
})

async function live(t: TestContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || (e instanceof Error && /fetch failed/i.test(e.message))) t.skip()
    else throw e
  }
}

describe.skipIf(!LIVE)('ip.blocklists (live)', () => {
  it('télécharge les listes réelles et classe une IP de botnet connue', (t) =>
    live(t, async () => {
      resetBlocklistCache()
      const ctx = makeContext()
      const progress: string[] = []
      ctx.progress = (_d, _t, detail) => detail && progress.push(detail)
      // Première IP de la liste Feodo (serveur de commande de botnet).
      const feodo = (await ctx.fetchText('https://feodotracker.abuse.ch/downloads/ipblocklist.txt')).split('\n').find((l) => /^\d/.test(l))?.trim()
      const out = await runModule(blocklists, entity('ip', feodo ?? '8.8.8.8'), ctx)
      expect(out.properties?.blocklists_unavailable ?? []).toEqual([])
      if (feodo) expect(out.properties?.listed_in).toContain('abuse.ch Feodo Tracker')
      expect(progress.length).toBeGreaterThanOrEqual(7)
      // Google DNS : signalé nulle part, mais commenté par DShield.
      const google = await runModule(blocklists, entity('ip', '8.8.8.8'), ctx)
      expect(google.properties?.listed_count).toBe(0)
      expect(google.properties?.dshield_comment).toMatch(/Google/)
    }), 180000)
})
