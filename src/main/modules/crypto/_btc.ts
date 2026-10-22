// Adresse Bitcoin d'une sortie « pay-to-pubkey » (P2PK) : les premières transactions (bloc de
// genèse, récompenses de minage de 2009-2010) paient une clé publique, sans adresse. Les
// explorateurs affichent l'adresse P2PKH équivalente : HASH160 de la clé, en Base58Check.
// RIPEMD-160 est écrit ici : le BoringSSL d'Electron ne le fournit pas à `createHash`.

import { createHash } from 'node:crypto'

const ZL = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3,
  7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13
]
const ZR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12,
  2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11
]
const SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9,
  8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6
]
const SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14,
  6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11
]
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e]
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000]

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n))

function f(j: number, x: number, y: number, z: number): number {
  if (j < 16) return x ^ y ^ z
  if (j < 32) return (x & y) | (~x & z)
  if (j < 48) return (x | ~y) ^ z
  if (j < 64) return (x & z) | (y & ~z)
  return x ^ (y | ~z)
}

/** RIPEMD-160 (spécification de Dobbertin, Bosselaers et Preneel, 1996). */
export function ripemd160(data: Uint8Array): Buffer {
  const bitLen = data.length * 8
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLen >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true)
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const x = new Array<number>(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) x[i] = view.getUint32(off + i * 4, true)
    let al = h0, bl = h1, cl = h2, dl = h3, el = h4
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4
    for (let j = 0; j < 80; j++) {
      let t = (rotl((al + f(j, bl, cl, dl) + x[ZL[j]] + KL[j >> 4]) | 0, SL[j]) + el) | 0
      al = el
      el = dl
      dl = rotl(cl, 10)
      cl = bl
      bl = t
      t = (rotl((ar + f(79 - j, br, cr, dr) + x[ZR[j]] + KR[j >> 4]) | 0, SR[j]) + er) | 0
      ar = er
      er = dr
      dr = rotl(cr, 10)
      cr = br
      br = t
    }
    const t = (h1 + cl + dr) | 0
    h1 = (h2 + dl + er) | 0
    h2 = (h3 + el + ar) | 0
    h3 = (h4 + al + br) | 0
    h4 = (h0 + bl + cr) | 0
    h0 = t
  }
  const out = Buffer.alloc(20)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => out.writeInt32LE(h, i * 4))
  return out
}

const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest()

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Base58Check : charge utile suivie des 4 premiers octets de son double SHA-256. */
export function base58check(payload: Uint8Array): string {
  const full = Buffer.concat([Buffer.from(payload), sha256(sha256(payload)).subarray(0, 4)])
  let n = BigInt('0x' + (full.toString('hex') || '0'))
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const byte of full) {
    if (byte !== 0) break
    out = '1' + out
  }
  return out
}

/** Adresse P2PKH d'une clé publique (65 octets non compressée ou 33 octets compressée). */
export function p2pkhAddress(pubkey: Uint8Array): string {
  return base58check(Buffer.concat([Buffer.from([0x00]), ripemd160(sha256(pubkey))]))
}

/** Adresse équivalente d'un script P2PK (`<push clé> OP_CHECKSIG`), sinon `null`. */
export function p2pkScriptAddress(scriptHex: string): string | null {
  const m = scriptHex.toLowerCase().match(/^(?:41(04[0-9a-f]{128})|21(0[23][0-9a-f]{64}))ac$/)
  if (!m) return null
  return p2pkhAddress(Buffer.from(m[1] ?? m[2], 'hex'))
}
