// Contacts WHOIS / RDAP : valeurs masquées ou génériques, noms de sociétés,
// rapprochement d'un contact avec le registrar.

/** Texte comparable : sans accents, en minuscules, ponctuation remplacée par des espaces. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@&/+]+/g, ' ')
    .trim()
}

/**
 * Mentions de masquage (RGPD, service d'anonymat, publication restreinte). Une valeur qui
 * contient l'une d'elles, comparée sans casse ni accents, n'est pas une donnée du titulaire.
 */
export const MASKED_WHOIS_VALUES: readonly string[] = [
  'redacted',
  'redacted for privacy',
  'withheld',
  'withheld for privacy',
  'data protected',
  'data protection',
  'privacy service',
  'privacy protect',
  'privacy protected',
  'privacy protection',
  'privacyguardian',
  'privacyprotect',
  'whois privacy',
  'whoisprivacy',
  'domain privacy',
  'contact privacy',
  'perfect privacy',
  'super privacy',
  'private registration',
  'registration private',
  'private registrant',
  'private person',
  'identity protect',
  'identity protection',
  'id protect',
  'domain protection',
  'domains by proxy',
  'whoisguard',
  'whois guard',
  'whoisproxy',
  'whois proxy',
  'whois agent',
  'proxy protection',
  'not disclosed',
  'non disclosed',
  'not shown',
  'not visible',
  'non communique',
  'non communiquee',
  'non diffuse',
  'diffusion restreinte',
  'non public',
  'non publique',
  'not public',
  'gdpr',
  'rgpd',
  'gdpr masked',
  'statutory masking',
  'statutory masking enabled',
  'masked',
  'masque',
  'masquee',
  'ano nymous',
  'anonymous',
  'anonymise',
  'anonymised',
  'anonymized',
  'hidden',
  'please query',
  'on behalf of',
  'see privacy',
  'not available',
  'not applicable',
  'confidential',
  'confidentiel',
  'confidentielle'
]

/** Valeurs génériques sans information quand elles constituent toute la valeur. */
const GENERIC_WHOLE = new Set(['private', 'privacy', 'protected', 'unknown', 'inconnu', 'none', 'null', 'nil', 'undefined', 'n/a', 'na', 'nc', 'n c', 'x', 'xx', 'test'])

/** Mots d'un intitulé de fonction (« Domain Administrator », « Service technique »), pas d'un nom. */
const ROLE_WORDS = new Set(
  (
    'the of de du des la le les et and for pour ' +
    'technical tech it dns domain domains name names admin administrative administrator administrateur administration ' +
    'billing legal abuse contact contacts department dept team manager management service services support ' +
    'technique technical informatique juridique administratif administrative facturation direction pole equipe responsable ' +
    'noms nom domaine domaines hostmaster webmaster postmaster registrant owner holder titulaire network operations noc ops ' +
    'gestionnaire gestion'
  ).split(' ')
)

const MASKED_PATTERNS = MASKED_WHOIS_VALUES.map((v) => new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`))

/**
 * Valeur WHOIS masquée ou sans information : vide, faite de caractères de masquage
 * (`***`, `xxx`, `---`), étoilée (`J*** D***`), mention de confidentialité ou valeur générique.
 */
export function isMaskedValue(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return true
  if (/^[\s*xX•●·.\-_#?/]+$/.test(s) || /\*{2,}/.test(s)) return true
  const f = foldText(s)
  if (!f || GENERIC_WHOLE.has(f)) return true
  return MASKED_PATTERNS.some((re) => re.test(f))
}

/** Intitulé de fonction ou de service sans nom propre (« Technical department », « Hostmaster »). */
export function isGenericRole(v: string): boolean {
  const words = foldText(v).split(' ').filter(Boolean)
  return words.length > 0 && words.every((w) => ROLE_WORDS.has(w))
}

/** Valeur exploitable (ni masquée, ni générique), nettoyée, ou `null`. */
export function visibleValue(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return s && !isMaskedValue(s) ? s : null
}

/** Nom exploitable : en plus des valeurs masquées, écarte les intitulés de fonction. */
export function visibleName(v: unknown): string | null {
  const s = visibleValue(v)
  return s && !isGenericRole(s) ? s : null
}

// Formes juridiques (sans points ni casse) et mots qui désignent une structure, pas une personne.
const LEGAL_FORMS = new Set(
  (
    'sa sas sasu sarl sarlu eurl snc sci scop scm scp sel selarl selas gie sem spl epic sca ' +
    'llc llp lllp lp inc incorporated corp corporation co company ltd limited plc pllc ' +
    'gmbh ag kg kgaa ohg ug ev bv nv vof spa srl sl slu ab a/s aps oy oyj kk pty pte se sro kft zrt doo lda ltda ehf uab sagl'
  ).split(' ')
)
const ORG_WORDS = new Set(
  (
    'association fondation foundation societe society groupe group holding holdings mairie commune ville universite university ' +
    'ministere ministry institut institute departement department region conseil agence agency club federation syndicat cabinet ' +
    'chambre office school ecole lycee college hopital hospital clinique laboratoire laboratoires bank banque assurance assurances ' +
    'mutuelle communaute community collectif ong ngo gouvernement government prefecture tribunal academie academy organisation ' +
    'organization services solutions technologies technology systems network networks hosting internet media studio studios ' +
    'consulting registrar registry domains telecom communications editions edition journal presse entreprise enterprises trust'
  ).split(' ')
)

/** Sigles avec points (`S.A.S.`, `L.L.C.`, `S.à r.l.`) ramenés à leur forme compacte. */
function compactLegal(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b([a-z])\.(?=[a-z]\.?)/g, '$1')
    .replace(/\b(s)\s*a\s*r\s*l\b/g, 'sarl')
}

/** Nom de société ou d'organisme (forme juridique, mot du type « Association », « Mairie »...). */
export function isCompanyName(v: string | null | undefined): boolean {
  if (!v) return false
  const words = foldText(compactLegal(v)).split(' ').filter(Boolean)
  return words.some((w) => LEGAL_FORMS.has(w) || ORG_WORDS.has(w))
}

/** Nom qui ressemble à celui d'une personne : au moins deux mots, sans chiffres ni forme juridique. */
export function looksLikePerson(v: string | null | undefined): boolean {
  if (!v || /\d|@/.test(v) || isCompanyName(v) || isGenericRole(v)) return false
  const words = v.trim().split(/\s+/)
  return words.length >= 2 && words.length <= 6 && words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w))
}

// Mots trop courants pour identifier une société quand on compare deux raisons sociales.
const WEAK_WORDS = new Set([
  ...LEGAL_FORMS,
  ...'network networks group groupe holding holdings international internet services service solutions technologies technology web hosting registrar registry domains domain online cloud the le la les de du des et and com net'.split(
    ' '
  )
])

/** Mots distinctifs d'une raison sociale (`Infomaniak Network SA` → `infomaniak`). */
export function companyCore(v: string): string[] {
  return foldText(compactLegal(v))
    .split(' ')
    .filter((w) => w.length > 1 && !WEAK_WORDS.has(w))
}

/**
 * Deux raisons sociales désignent-elles la même société (`OVH SAS` et `OVH`, `Gandi` et `GANDI SAS`) ?
 * Mots distinctifs identiques, ou inclus l'un dans l'autre quand aucun des deux noms n'est celui
 * d'une personne (« Jean Dupont » n'est pas « Dupont SA »).
 */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (foldText(a) === foldText(b)) return true
  const x = companyCore(a)
  const y = companyCore(b)
  if (!x.length || !y.length) return false
  const [small, big] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)]
  if (!small.every((w) => big.has(w))) return false
  return small.length === big.size || !(looksLikePerson(a) || looksLikePerson(b))
}

/** Libellé distinctif d'un nom de domaine (`abuse@infomaniak.ch` → `infomaniak`). */
export function domainBase(hostOrEmail: string): string | null {
  const host = hostOrEmail.toLowerCase().replace(/^.*@/, '').replace(/^https?:\/\//, '').split(/[/:?#]/)[0]
  const labels = host.split('.').filter(Boolean)
  if (labels.length < 2) return null
  // Domaines sous suffixe à deux niveaux (co.uk, com.au...) : on remonte d'un cran.
  const second = labels[labels.length - 2]
  const base = /^(co|com|net|org|gov|ac|edu|ne|or)$/.test(second) && labels.length >= 3 ? labels[labels.length - 3] : second
  return base || null
}

/** Adresse de relais d'un service d'anonymat (`xxx@privacyguardian.org`, `xxx@o-w-o.info`). */
export function isProxyEmail(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? ''
  return /privacy|whois|proxy|anonymi[sz]ed|redacted|o-w-o\.info|identity-protect|protecteddomain/.test(domain)
}
