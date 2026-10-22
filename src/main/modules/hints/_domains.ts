// Fournisseurs de messagerie grand public, classés du plus courant au plus rare (public
// français d'abord), et contraintes connues sur la partie locale des adresses.

export const EMAIL_PROVIDERS: readonly string[] = [
  'gmail.com',
  'hotmail.com',
  'hotmail.fr',
  'outlook.com',
  'outlook.fr',
  'yahoo.fr',
  'yahoo.com',
  'icloud.com',
  'orange.fr',
  'live.fr',
  'live.com',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'wanadoo.fr',
  'gmx.fr',
  'gmx.com',
  'googlemail.com',
  'me.com',
  'msn.com',
  'aol.com',
  'aol.fr',
  'protonmail.com',
  'proton.me',
  'neuf.fr',
  'bbox.fr',
  'numericable.fr',
  'club-internet.fr',
  'aliceadsl.fr',
  'ymail.com',
  'mac.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  't-online.de',
  'hotmail.be',
  'outlook.be',
  'live.be',
  'skynet.be',
  'telenet.be',
  'bluewin.ch',
  'hotmail.co.uk',
  'yahoo.co.uk',
  'live.co.uk',
  'btinternet.com',
  'hotmail.de',
  'outlook.de',
  'yahoo.de',
  'hotmail.it',
  'libero.it',
  'yahoo.it',
  'hotmail.es',
  'outlook.es',
  'yahoo.es',
  'yahoo.ca',
  'hotmail.ca',
  'videotron.ca',
  'mail.com',
  'pm.me',
  'tutanota.com',
  'tuta.io',
  'zoho.com',
  'fastmail.com',
  'yandex.ru',
  'yandex.com',
  'mail.ru',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net'
]

/** Domaines des comptes Microsoft grand public (boîte Outlook, Hotmail, Live, MSN). */
export const isMicrosoftConsumerDomain = (domain: string): boolean => /^(outlook|hotmail|live|msn|windowslive|passport)\.[a-z.]+$/.test(domain)

/**
 * Domaines Microsoft encore ouverts à l'inscription. Pour les autres (hotmail.fr, live.fr,
 * outlook.fr, msn.com...), l'inscription répond « domaine réservé » (code 1181) sans rien
 * dire de l'adresse : inutile de les vérifier.
 */
export const isMicrosoftSignupDomain = (domain: string): boolean => domain === 'outlook.com' || domain === 'hotmail.com'

// Règles de création d'adresse connues (longueur, caractères admis).
const LOCAL_RULES: Array<[RegExp, RegExp]> = [
  // Gmail : 6 à 30 caractères, lettres, chiffres et points.
  [/^(gmail|googlemail)\.com$/, /^[a-z0-9][a-z0-9.]{4,28}[a-z0-9]$/],
  // Outlook, Hotmail, Live : commence par une lettre.
  [/^(outlook|hotmail|live|msn)\./, /^[a-z][a-z0-9._-]{0,63}$/],
  // Yahoo : 4 à 32 caractères, lettres, chiffres, points et tirets bas.
  [/^(yahoo|ymail)\./, /^[a-z][a-z0-9._]{3,31}$/],
  // iCloud : 3 à 20 caractères, commence par une lettre.
  [/^(icloud|me|mac)\.com$/, /^[a-z][a-z0-9._]{2,19}$/]
]

/** La partie locale peut-elle exister chez ce fournisseur ? */
export function plausibleLocal(local: string, domain: string): boolean {
  if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(local) || local.includes('..')) return false
  const rule = LOCAL_RULES.find(([d]) => d.test(domain))
  return rule ? rule[1].test(local) : true
}
