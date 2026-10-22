// Lecture des clés OpenPGP publiques : index « machine » des serveurs HKP
// (keyserver.ubuntu.com, api.protonmail.ch) et clés armurées de keys.openpgp.org.
// Seul l'en-tête des paquets est lu : clé principale, identités (uid) et révocation.

import { createHash } from 'node:crypto'

export interface PgpUid {
  /** Nom de l'identité (« Debian Security Team »), sans le commentaire. */
  name?: string
  email?: string
  raw: string
}

export interface PgpKey {
  /** Empreinte en majuscules (ou identifiant long quand le serveur ne donne que lui). */
  fingerprint: string
  /** « RSA 4096 », « EdDSA »... */
  algorithm?: string
  /** Date de création de la clé principale (AAAA-MM-JJ). */
  createdAt?: string
  expiresAt?: string
  revoked?: boolean
  expired?: boolean
  uids: PgpUid[]
}

const ALGORITHMS: Record<number, string> = {
  1: 'RSA',
  2: 'RSA',
  3: 'RSA',
  16: 'Elgamal',
  17: 'DSA',
  18: 'ECDH',
  19: 'ECDSA',
  22: 'EdDSA',
  25: 'X25519',
  27: 'Ed25519',
  28: 'X448',
  29: 'Ed448'
}

export function algorithmName(algo: number | undefined, bits?: number): string | undefined {
  if (algo === undefined || Number.isNaN(algo)) return undefined
  const name = ALGORITHMS[algo] ?? `algo ${algo}`
  return bits ? `${name} ${bits}` : name
}

/** Horodatage Unix (secondes) vers AAAA-MM-JJ. */
function day(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds)) return undefined
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** « Nom (commentaire) <adresse> » : nom et adresse séparés. */
export function splitUid(raw: string): PgpUid {
  const text = raw.trim()
  const m = text.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/)
  const email = (m ? m[2] : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : undefined)?.toLowerCase()
  const name = (m ? m[1] : email ? '' : text).replace(/\s*\([^)]*\)\s*$/, '').trim()
  return { raw: text, ...(name ? { name } : {}), ...(email ? { email } : {}) }
}

/** Décode les séquences `%XX` d'un champ HKP, sans échouer sur une séquence mal formée. */
function unescapeHkp(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  }
}

/**
 * Index HKP au format machine (`op=index&options=mr`) :
 * `info:1:<nombre>`, puis `pub:<empreinte>:<algo>:<taille>:<création>:<expiration>:<drapeaux>`
 * et `uid:<identité>:<création>:<expiration>:<drapeaux>` (drapeaux r révoquée, e expirée).
 * `null` si le texte n'est pas un index.
 */
export function parseHkpIndex(text: string): { count: number; keys: PgpKey[] } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const info = lines.find((l) => l.startsWith('info:'))
  if (!info && !lines.some((l) => l.startsWith('pub:'))) return null
  const keys: PgpKey[] = []
  for (const line of lines) {
    const f = line.split(':')
    if (f[0] === 'pub' && f[1]) {
      const flags = f[6] ?? ''
      keys.push({
        fingerprint: f[1].toUpperCase(),
        algorithm: algorithmName(f[2] ? Number(f[2]) : undefined, f[3] ? Number(f[3]) : undefined),
        createdAt: day(Number(f[4])),
        expiresAt: day(Number(f[5])),
        ...(flags.includes('r') ? { revoked: true } : {}),
        ...(flags.includes('e') ? { expired: true } : {}),
        uids: []
      })
    } else if (f[0] === 'uid' && keys.length && f[1]) {
      if ((f[4] ?? '').includes('r')) continue
      keys[keys.length - 1].uids.push(splitUid(unescapeHkp(f[1])))
    }
  }
  const announced = info ? Number(info.split(':')[2]) : NaN
  return { count: Number.isFinite(announced) ? announced : keys.length, keys }
}

// ---------------------------------------------------------------------------
// Clés armurées (RFC 9580)

/** Contenu binaire d'un bloc `-----BEGIN PGP PUBLIC KEY BLOCK-----` ; `null` s'il manque. */
export function dearmor(text: string): Buffer | null {
  const m = text.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/)
  if (!m) return null
  // En-têtes d'armure (« Comment: ... »), lignes vides et somme de contrôle (« =XXXX ») ignorés :
  // une ligne base64 ne contient ni deux-points ni espace.
  const b64 = m[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.includes(':') && !l.startsWith('='))
    .join('')
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null
  return Buffer.from(b64, 'base64')
}

interface Packet {
  tag: number
  body: Buffer
}

/** Découpe une suite de paquets OpenPGP (en-têtes ancien et nouveau format). */
export function readPackets(buf: Buffer): Packet[] {
  const out: Packet[] = []
  let i = 0
  while (i < buf.length) {
    const h = buf[i]
    if (!(h & 0x80)) break
    let tag: number
    let len: number
    let start: number
    if (h & 0x40) {
      tag = h & 0x3f
      const o1 = buf[i + 1]
      if (o1 < 192) {
        len = o1
        start = i + 2
      } else if (o1 < 224) {
        len = ((o1 - 192) << 8) + buf[i + 2] + 192
        start = i + 3
      } else if (o1 === 255) {
        len = buf.readUInt32BE(i + 2)
        start = i + 6
      } else break // longueur partielle : absente des clés publiques
    } else {
      tag = (h >> 2) & 0x0f
      const type = h & 0x03
      if (type === 0) {
        len = buf[i + 1]
        start = i + 2
      } else if (type === 1) {
        len = buf.readUInt16BE(i + 1)
        start = i + 3
      } else if (type === 2) {
        len = buf.readUInt32BE(i + 1)
        start = i + 5
      } else {
        len = buf.length - (i + 1)
        start = i + 1
      }
    }
    if (start + len > buf.length) break
    out.push({ tag, body: buf.subarray(start, start + len) })
    i = start + len
  }
  return out
}

/** Empreinte, date et algorithme d'un paquet de clé publique (versions 4, 5 et 6). */
function publicKeyInfo(body: Buffer): Omit<PgpKey, 'uids'> | null {
  const version = body[0]
  if (body.length < 6 || (version !== 4 && version !== 5 && version !== 6)) return null
  const created = body.readUInt32BE(1)
  const algo = body[5]
  let fingerprint: string
  if (version === 4) {
    const head = Buffer.alloc(3)
    head[0] = 0x99
    head.writeUInt16BE(body.length, 1)
    fingerprint = createHash('sha1').update(head).update(body).digest('hex')
  } else {
    const head = Buffer.alloc(5)
    head[0] = version === 5 ? 0x9a : 0x9b
    head.writeUInt32BE(body.length, 1)
    fingerprint = createHash('sha256').update(head).update(body).digest('hex')
  }
  // Taille du module pour RSA, DSA et Elgamal : longueur en bits du premier MPI.
  const mpiAt = version === 4 ? 6 : 10
  const bits = [1, 2, 3, 16, 17].includes(algo) && body.length > mpiAt + 2 ? body.readUInt16BE(mpiAt) : undefined
  return { fingerprint: fingerprint.toUpperCase(), algorithm: algorithmName(algo, bits), createdAt: day(created) }
}

/** Clés d'un bloc armuré : empreinte, date de création, identités et révocation. */
export function parseArmoredKeys(text: string): PgpKey[] {
  const buf = dearmor(text)
  if (!buf) return []
  const keys: PgpKey[] = []
  let current: PgpKey | null = null
  // Une signature de révocation (type 0x20) placée avant toute identité porte sur la clé principale.
  let beforeUids = false
  for (const p of readPackets(buf)) {
    if (p.tag === 6) {
      const info = publicKeyInfo(p.body)
      current = info ? { ...info, uids: [] } : null
      if (current) keys.push(current)
      beforeUids = true
    } else if (p.tag === 13 && current) {
      current.uids.push(splitUid(p.body.toString('utf8')))
      beforeUids = false
    } else if (p.tag === 14 || p.tag === 17) {
      beforeUids = false
    } else if (p.tag === 2 && current && beforeUids && p.body.length > 1 && p.body[0] >= 4 && p.body[1] === 0x20) {
      current.revoked = true
    }
  }
  return keys
}

/** Description courte d'une clé : « EMPREINTE · RSA 4096 · 2015-01-18 · révoquée ». */
export function describeKey(k: PgpKey, lang: 'fr' | 'en'): string {
  const state = k.revoked ? (lang === 'fr' ? 'révoquée' : 'revoked') : k.expired ? (lang === 'fr' ? 'expirée' : 'expired') : ''
  return [k.fingerprint, k.algorithm, k.createdAt, state].filter(Boolean).join(' · ')
}

/** Date de création la plus ancienne d'une liste de clés. */
export function oldestKeyDate(keys: PgpKey[]): string | undefined {
  return keys
    .map((k) => k.createdAt)
    .filter((d): d is string => !!d)
    .sort()[0]
}
