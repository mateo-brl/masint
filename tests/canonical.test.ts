// Formes canoniques des identifiants (valeurs fictives : numéros de la plage réservée à la
// fiction, domaines et adresses de documentation).

import { describe, expect, it } from 'vitest'
import {
  canonicalDomain,
  canonicalEmail,
  canonicalIban,
  canonicalIp,
  canonicalKey,
  canonicalPhone,
  canonicalUrl,
  canonicalValue,
  canonicalWallet,
  compressIpv6
} from '@shared/canonical'

describe('canonicalPhone', () => {
  it('ramène les formats nationaux et internationaux au format E.164', () => {
    for (const raw of ['06 39 98 12 34', '0639981234', '+33639981234', '+33 6 39 98 12 34', '0033 6 39 98 12 34', '+33 (0)6 39 98 12 34', '06.39.98.12.34', '06-39-98-12-34'])
      expect(canonicalPhone(raw)).toBe('+33639981234')
  })

  it('garde le pays des numéros étrangers', () => {
    expect(canonicalPhone('+44 20 7946 0958')).toBe('+442079460958')
    expect(canonicalPhone('+1 (202) 555-0143')).toBe('+12025550143')
  })

  it("conserve l'extension", () => {
    expect(canonicalPhone('+33 6 39 98 12 34 ext. 12')).toBe('+33639981234;ext=12')
  })

  it('se replie sur les chiffres pour une valeur impossible', () => {
    expect(canonicalPhone('3639')).toBe('3639')
    expect(canonicalPhone('00 12 34')).toBe('+1234')
  })
})

describe('canonicalEmail', () => {
  it('met en minuscules et retire les espaces', () => {
    expect(canonicalEmail('  Jean.Exemple@Example.COM ')).toBe('jean.exemple@example.com')
    expect(canonicalEmail('jean exemple@example.com')).toBe('jeanexemple@example.com')
  })

  it('ne retire pas les points Gmail (ce serait une hypothèse)', () => {
    expect(canonicalEmail('jean.exemple@gmail.com')).not.toBe(canonicalEmail('jeanexemple@gmail.com'))
  })
})

describe('canonicalDomain', () => {
  it('retire schéma, www, chemin, port et point final', () => {
    for (const raw of ['Example.com', 'www.example.com', 'example.com.', 'https://www.Example.com/', 'http://example.com:8080/page?q=1', 'WWW.EXAMPLE.COM.'])
      expect(canonicalDomain(raw)).toBe('example.com')
  })

  it('garde les sous-domaines', () => {
    expect(canonicalDomain('mail.example.com')).toBe('mail.example.com')
  })

  it('convertit un nom international en punycode', () => {
    expect(canonicalDomain('café.example')).toBe('xn--caf-dma.example')
  })
})

describe('canonicalUrl', () => {
  it('met schéma et hôte en minuscules, sans fragment ni / final', () => {
    expect(canonicalUrl('HTTPS://Example.COM/Profil/#haut')).toBe('https://example.com/Profil')
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com')
    expect(canonicalUrl('https://example.com/a?b=C')).toBe('https://example.com/a?b=C')
  })

  it('garde la casse du chemin et le port non standard', () => {
    expect(canonicalUrl('https://example.com:8443/Page')).toBe('https://example.com:8443/Page')
    expect(canonicalUrl('https://example.com:443/Page')).toBe('https://example.com/Page')
  })

  it('distingue http et https', () => {
    expect(canonicalUrl('http://example.com/a')).not.toBe(canonicalUrl('https://example.com/a'))
  })

  it('traite une adresse sans schéma', () => {
    expect(canonicalUrl('Example.com/Page/#x')).toBe('example.com/Page')
  })
})

describe('canonicalIp', () => {
  it('compresse les adresses IPv6', () => {
    expect(canonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    expect(canonicalIp('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1')
    expect(canonicalIp('2001:db8::0:1')).toBe('2001:db8::1')
    expect(canonicalIp('0:0:0:0:0:0:0:1')).toBe('::1')
    expect(canonicalIp('0:0:0:0:0:0:0:0')).toBe('::')
    expect(canonicalIp('[2001:db8::1]')).toBe('2001:db8::1')
  })

  it('ne compresse pas un seul groupe nul', () => {
    expect(canonicalIp('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1')
  })

  it('convertit une IPv4 intégrée', () => {
    expect(canonicalIp('::ffff:192.0.2.1')).toBe('::ffff:c000:201')
  })

  it('garde la zone et les IPv4', () => {
    expect(canonicalIp('FE80::1%eth0')).toBe('fe80::1%eth0')
    expect(canonicalIp(' 192.0.2.10 ')).toBe('192.0.2.10')
  })

  it('refuse les formes invalides', () => {
    expect(compressIpv6('2001:db8::1::2')).toBeNull()
    expect(compressIpv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(compressIpv6('2001:db8::zz')).toBeNull()
  })
})

describe('autres types', () => {
  it('IBAN sans espaces, en majuscules', () => {
    expect(canonicalIban('fr76 3000 6000 0112 3456 7890 189')).toBe('FR7630006000011234567890189')
  })

  it('portefeuilles : casse gardée sauf Ethereum', () => {
    expect(canonicalWallet('0xAbCdEf0123456789aBcDeF0123456789AbCdEf01')).toBe('0xabcdef0123456789abcdef0123456789abcdef01')
    expect(canonicalWallet('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')
    expect(canonicalWallet('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).not.toBe(canonicalWallet('1boatslrhtknngkdxeeobr76b53lettpyt'))
  })

  it('empreintes en minuscules', () => {
    expect(canonicalValue('hash', 'D41D8CD98F00B204E9800998ECF8427E')).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })

  it('pseudos sans @, espaces resserrés', () => {
    expect(canonicalValue('username', '@Exemple_42')).toBe('exemple_42')
    expect(canonicalValue('person', '  Jean   Exemple ')).toBe('jean exemple')
  })
})

describe('canonicalKey', () => {
  it('fusionne un numéro saisi à la main et le même trouvé par un module', () => {
    expect(canonicalKey('phone', '06 39 98 12 34')).toBe(canonicalKey('phone', '+33639981234'))
  })

  it('ignore la plateforme pour les identifiants qui se suffisent', () => {
    expect(canonicalKey('email', 'jean@gmail.com', 'gmail')).toBe(canonicalKey('email', 'JEAN@gmail.com', null))
    expect(canonicalKey('phone', '+33639981234', 'orange')).toBe(canonicalKey('phone', '0639981234'))
    expect(canonicalKey('domain', 'example.com', 'x')).toBe(canonicalKey('domain', 'www.example.com'))
    expect(canonicalKey('ip', '2001:db8::1', 'a')).toBe(canonicalKey('ip', '2001:DB8:0:0::1'))
    expect(canonicalKey('iban', 'FR76 3000 6000 0112 3456 7890 189', 'x')).toBe(canonicalKey('iban', 'FR7630006000011234567890189'))
    expect(canonicalKey('crypto_wallet', '0xABCDEF0123456789ABCDEF0123456789ABCDEF01', 'ethereum')).toBe(
      canonicalKey('crypto_wallet', '0xabcdef0123456789abcdef0123456789abcdef01', 'bsc')
    )
    expect(canonicalKey('hash', 'ABC', 'x')).toBe(canonicalKey('hash', 'abc'))
  })

  it('garde la plateforme pour les comptes et pseudos', () => {
    expect(canonicalKey('account', 'exemple', 'github')).not.toBe(canonicalKey('account', 'exemple', 'gitlab'))
    expect(canonicalKey('username', 'exemple', 'github')).not.toBe(canonicalKey('username', 'exemple', null))
    expect(canonicalKey('account', '@Exemple', 'github')).toBe(canonicalKey('account', 'exemple', 'github'))
  })

  it('distingue les types', () => {
    expect(canonicalKey('domain', 'example.com')).not.toBe(canonicalKey('website', 'example.com'))
  })
})
