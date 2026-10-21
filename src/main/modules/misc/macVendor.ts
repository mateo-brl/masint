// Constructeur d'une carte réseau à partir de l'adresse MAC (préfixe OUI de l'IEEE),
// via macvendorlookup.com puis api.macvendors.com. Les adresses aléatoires
// (administrées localement, fréquentes sur les smartphones) sont signalées sans requête.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, serviceError, tr } from './_util'

export interface MacInfo {
  mac: string
  oui: string
  local: boolean
  multicast: boolean
}

export function parseMac(raw: string): MacInfo | null {
  const hex = raw.replace(/[^0-9a-f]/gi, '').toUpperCase()
  if (hex.length !== 12) return null
  const first = parseInt(hex.slice(0, 2), 16)
  return {
    mac: hex.match(/.{2}/g)!.join(':'),
    oui: hex.slice(0, 6).match(/.{2}/g)!.join(':'),
    local: (first & 0x02) !== 0,
    multicast: (first & 0x01) !== 0
  }
}

export interface MvlRecord {
  company: string
  addressL1?: string
  addressL2?: string
  addressL3?: string
  country?: string
  type?: string
  startHex?: string
  endHex?: string
}

export function macOutput(ctx: Pick<ModuleContext, 'lang'>, m: MacInfo, vendor: MvlRecord | null): ModuleOutput {
  const address = vendor ? [vendor.addressL1, vendor.addressL2, vendor.addressL3].map((s) => s?.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ') : null
  const properties = compact({
    mac: m.mac,
    oui: m.oui,
    vendor: vendor?.company ?? null,
    vendor_address: address,
    vendor_country: vendor?.country ?? null,
    oui_block: vendor?.type ?? null,
    locally_administered: m.local,
    randomized: m.local ? tr(ctx, 'probable (adresse aléatoire ou virtuelle)', 'likely (random or virtual address)') : null,
    multicast: m.multicast || null
  })
  const entities: OutEntity[] = vendor
    ? [{ type: 'organization', label: vendor.company, data: { kind: tr(ctx, 'constructeur', 'manufacturer'), country: vendor.country ?? null }, linkLabel: tr(ctx, 'constructeur', 'manufacturer') }]
    : []
  return { properties, entities, raw: vendor }
}

async function lookup(ctx: ModuleContext, mac: string): Promise<MvlRecord | null> {
  const dashed = mac.replace(/:/g, '-')
  try {
    const res = await ctx.fetch(`https://www.macvendorlookup.com/api/v2/${dashed}`, { timeoutMs: 15000 })
    if (res.status === 204 || res.status === 404) return null
    if (res.ok) {
      const list = (await res.json()) as MvlRecord[]
      return list?.[0]?.company ? list[0] : null
    }
  } catch (e) {
    ctx.log(`macvendorlookup.com : ${e instanceof Error ? e.message : String(e)}`)
  }
  // Secours : réponse texte brute (nom du constructeur uniquement).
  let res: Response
  try {
    res = await ctx.fetch(`https://api.macvendors.com/${encodeURIComponent(mac)}`, { timeoutMs: 15000 })
  } catch (e) {
    throw serviceError(e, 'MAC Vendors')
  }
  if (res.status === 404) return null
  if (res.status === 429) throw new ModuleError('MAC Vendors : quota dépassé, réessayer plus tard', 'rate_limited')
  if (!res.ok) throw serviceError(Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }), 'MAC Vendors')
  const name = (await res.text()).trim()
  return name ? { company: name } : null
}

export default defineModule({
  id: 'misc.mac_vendor',
  name: { fr: "Constructeur de l'adresse MAC", en: 'MAC address vendor' },
  description: {
    fr: "Fabricant de la carte réseau (préfixe OUI de l'IEEE), son adresse et son pays. Signale les adresses aléatoires ou virtuelles, qui ne désignent pas un constructeur.",
    en: 'Network card manufacturer (IEEE OUI prefix), its address and country. Flags random or virtual addresses, which do not identify a manufacturer.'
  },
  category: 'misc',
  inputTypes: ['mac_address'],
  homepage: 'https://www.macvendorlookup.com',
  async run(input, ctx) {
    const m = parseMac(input.label)
    if (!m) throw new ModuleError('Adresse MAC non reconnue', 'invalid_input')
    // Adresse administrée localement : aucun constructeur à rechercher.
    if (m.local) return macOutput(ctx, m, null)
    return macOutput(ctx, m, await lookup(ctx, m.mac))
  }
})
