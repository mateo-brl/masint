import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { algorithmOf } from '../../src/main/modules/forensic/_hash'
import cve, { cveOutput, parseCveRecord, parseNvd } from '../../src/main/modules/forensic/cve'
import hashlookup, { parseHashlookup } from '../../src/main/modules/forensic/hashlookup'
import hibp, { breachOutput, findBreach } from '../../src/main/modules/forensic/hibpBreach'
import { parseMalwareBazaar } from '../../src/main/modules/forensic/malwarebazaar'
import virustotal, { parseVirusTotal } from '../../src/main/modules/forensic/virustotal'
import { entity, LIVE, runModule } from '../helpers/context'

const json = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/forensic', name), 'utf8'))
const fr = { lang: 'fr' as const }

describe('forensic : empreintes', () => {
  it('déduit l’algorithme', () => {
    expect(algorithmOf(entity('hash', '8ED4B4ED952526D89899E723F3488DE4'))).toBe('MD5')
    expect(algorithmOf(entity('hash', '00000079FD7AAC9B2F9C988C50750E1F50B27EB5'))).toBe('SHA-1')
    expect(hashlookup.accepts!(entity('hash', 'a'.repeat(128)))).toBe(false)
    expect(virustotal.accepts!(entity('hash', 'a'.repeat(64)))).toBe(true)
  })

  it('CIRCL hashlookup : fichier connu et autres empreintes', () => {
    const out = parseHashlookup(fr, 'MD5', json('hashlookup_md5.json'))
    expect(out.properties).toMatchObject({
      known_file: true,
      file_size: 2520,
      known_source: 'NSRL',
      product: 'Cumulative Update for Windows Server 2016 for x64 (KB4338817) 1709',
      sha1: '00000079fd7aac9b2f9c988c50750e1f50b27eb5'
    })
    expect(out.properties?.os).toBeUndefined()
    expect(out.entities?.[0]).toMatchObject({ type: 'file', ref: 'file' })
    const hashes = out.entities!.filter((e) => e.type === 'hash')
    expect(hashes.map((h) => h.data?.algorithm)).toEqual(['SHA-1'])
    expect(hashes[0].from).toBe('file')
  })

  it('VirusTotal (format documenté)', () => {
    const out = parseVirusTotal(fr, {
      data: {
        id: 'e'.repeat(64),
        attributes: {
          meaningful_name: 'invoice.exe',
          type_description: 'Win32 EXE',
          size: 1024,
          first_submission_date: 1700000000,
          last_analysis_stats: { malicious: 50, suspicious: 1, undetected: 20, harmless: 0 },
          popular_threat_classification: { suggested_threat_label: 'trojan.emotet', popular_threat_name: [{ value: 'emotet', count: 30 }] }
        }
      }
    })
    expect(out.properties).toMatchObject({ vt_detections: '50/71', threat_label: 'trojan.emotet', first_seen: '2023-11-14T22:13:20.000Z' })
    expect(out.entities?.map((e) => e.type)).toEqual(['file', 'malware'])
  })

  it('MalwareBazaar (format documenté)', () => {
    expect(parseMalwareBazaar(fr, { query_status: 'hash_not_found' })).toEqual({})
    const out = parseMalwareBazaar(fr, {
      query_status: 'ok',
      data: [{ sha256_hash: 'f'.repeat(64), file_name: 'a.exe', signature: 'AgentTesla', first_seen: '2021-03-26 13:15:07', tags: ['exe'] }]
    })
    expect(out.properties).toMatchObject({ malware_family: 'AgentTesla', first_seen: '2021-03-26T13:15:07.000Z' })
    expect(out.entities?.[0]).toMatchObject({ type: 'malware', label: 'AgentTesla' })
  })
})

describe('forensic.cve (hors ligne)', () => {
  it('enregistrement CVE JSON 5 (cve.circl.lu)', () => {
    const info = parseCveRecord(json('cve_circl_2024_3400.json'))!
    const out = cveOutput(fr, info, { epss: 0.94, percentile: 0.999 })
    expect(out.properties).toMatchObject({
      cvss: 10,
      severity: 'CRITICAL',
      cvss_version: '3.1',
      cwe: ['CWE-77', 'CWE-20'],
      exploited: true,
      kev_added_date: '2024-04-12',
      exploitation: 'active',
      epss: '94.00 %',
      published_at: '2024-04-12T07:20:00.707Z'
    })
    expect(String(out.properties?.summary)).toMatch(/^A command injection/)
    expect(out.entities?.[0]).toMatchObject({ type: 'technology', label: 'Palo Alto Networks PAN-OS' })
  })

  it('NVD en secours', () => {
    const info = parseNvd(json('nvd_2024_3400.json'))!
    const out = cveOutput(fr, info, null)
    expect(out.properties).toMatchObject({ cvss: 10, severity: 'CRITICAL', kev_added_date: '2024-04-12', exploited: true })
    expect(out.properties?.cwe).toEqual(['CWE-20', 'CWE-77'])
    expect(out.properties?.published_at).toBe('2024-04-12T08:15:06.230Z')
  })

  it('CVE absente', () => {
    expect(parseCveRecord({})).toBeNull()
    expect(parseNvd({ vulnerabilities: [] })).toBeNull()
  })
})

describe('forensic.hibp_breach (hors ligne)', () => {
  it('détails de la fuite', () => {
    const out = breachOutput(fr, json('hibp_adobe.json'))
    expect(out.properties).toMatchObject({ breach_date: '2013-10-04', records: 152445165, domain: 'adobe.com' })
    expect(out.properties?.data_classes).toContain('Password hints')
    expect(String(out.properties?.description)).not.toMatch(/<a /)
    expect(out.entities?.[0]).toMatchObject({ type: 'domain', label: 'adobe.com' })
  })

  it('retrouve une fuite par son titre ou son domaine', () => {
    const list = json('hibp_breaches_sample.json')
    expect(findBreach(list, 'Adult FriendFinder (2015)')?.Name).toBe('AdultFriendFinder')
    expect(findBreach(list, 'linkedin.com')?.Name).toBe('LinkedIn')
    expect(findBreach(list, 'inconnue')).toBeNull()
  })
})

describe.skipIf(!LIVE)('forensic : services réels', () => {
  it('CIRCL hashlookup', async () => {
    const out = await runModule(hashlookup, entity('hash', '8ED4B4ED952526D89899E723F3488DE4'))
    expect(out.properties?.known_file).toBe(true)
    expect(await runModule(hashlookup, entity('hash', '0'.repeat(63) + '1'))).toEqual({})
  })

  it('CVE', async () => {
    const out = await runModule(cve, entity('cve', 'CVE-2024-3400'))
    expect(out.properties?.cvss).toBe(10)
    expect(String(out.properties?.epss)).toMatch(/%$/)
  })

  it('Have I Been Pwned', async () => {
    const out = await runModule(hibp, entity('breach', 'Adult FriendFinder (2015)'))
    expect(out.properties?.name).toBe('AdultFriendFinder')
  })
})
