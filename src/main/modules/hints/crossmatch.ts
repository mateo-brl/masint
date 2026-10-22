// Recoupement des indices masqués d'une entité (emails et téléphones de secours renvoyés par
// Apple via roso.info, Microsoft, Adobe, Amazon...) : ce qu'on peut en déduire (première
// lettre, fournisseur probable, chiffres connus) et des candidats compatibles, proposés dans
// « À vérifier » avec la raison du rapprochement.
//
// Le module ne voit que l'entité étudiée et ses propriétés : les candidats viennent des noms,
// pseudos, emails et numéros qui y figurent. Une adresse construite qui existe déjà dans
// l'enquête est reliée directement par le moteur.
//
// Seule requête réseau : les adresses construites les plus probables sont soumises à
// l'inscription Microsoft (« cet identifiant est-il libre ? »), qui ne contacte jamais le
// titulaire. Une adresse outlook.com ou hotmail.com libre n'existe pas et est écartée ; une
// adresse déjà utilisée par un compte Microsoft, quel que soit son domaine, passe en tête.

import { defineModule, type InputEntity, type OutEntity } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import { compact } from '../email/_lib'
import { emailsOf, localPartsFor, namesOf, phonesOf, pseudosOf } from './_candidates'
import { EMAIL_PROVIDERS, isMicrosoftConsumerDomain, isMicrosoftSignupDomain, plausibleLocal } from './_domains'
import {
  callingCodeLabel,
  domainsMatching,
  domainSuffix,
  emailMatches,
  exactDomain,
  localPrefix,
  localSuffix,
  localVisible,
  maskKey,
  parseEmailMask,
  parseHint,
  parsePhoneMask,
  phoneMatches,
  type EmailMask,
  type Hint,
  type PhoneMask
} from './_mask'
import { e164, microsoftAvailability, type Availability } from './_services'

/** Propriétés où les modules rangent des indices masqués. */
const HINT_KEYS = ['masked_emails', 'masked_phones', 'recovery_emails', 'recovery_phones', 'recovery_hints']
const MAX_HINTS = 20
/** Domaines essayés par indice pour construire des adresses. */
const MAX_DOMAINS = 4
/** Domaines cités dans une déduction. */
const SHOWN_DOMAINS = 6
const MAX_CANDIDATES = 10
/** Candidats retenus avant la vérification Microsoft. */
const POOL = 25
const MAX_CHECKS = 8

type Lang = 'fr' | 'en'
const t = (lang: Lang, fr: string, en: string): string => (lang === 'fr' ? fr : en)

/** Indices masqués de l'entité, regroupés quand plusieurs services renvoient le même masque. */
export function hintsOf(input: InputEntity): Hint[] {
  // Sur un compte, les indices viennent de la plateforme du compte (Apple, Microsoft...).
  const platform = input.type === 'account' ? getPlatform(input.platform)?.name : undefined
  const out = new Map<string, Hint>()
  for (const key of HINT_KEYS) {
    const v = input.data[key]
    const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const h = parseHint(raw, platform)
      if (!h) continue
      const k = maskKey(h)
      const prev = out.get(k)
      if (prev) prev.sources = Array.from(new Set([...prev.sources, ...h.sources]))
      else out.set(k, h)
    }
  }
  return [...out.values()].slice(0, MAX_HINTS)
}

export const hintLabel = (h: Hint): string => (h.sources.length ? `${h.mask} (${h.sources.join(', ')})` : h.mask)

/** Ce que l'on peut lire d'un email masqué. */
export function describeEmail(h: Hint, m: EmailMask, domains: string[], self: boolean, lang: Lang): string {
  const parts: string[] = []
  if (m.local.length === 1) parts.push(t(lang, `partie locale « ${m.local[0]} »`, `local part "${m.local[0]}"`))
  else {
    const pre = localPrefix(m)
    const suf = localSuffix(m)
    if (pre) parts.push(t(lang, `commence par « ${pre} »`, `starts with "${pre}"`))
    if (suf) parts.push(t(lang, `se termine par « ${suf} »`, `ends with "${suf}"`))
    if (!pre && !suf) parts.push(t(lang, 'partie locale entièrement masquée', 'local part fully masked'))
  }
  const exact = exactDomain(m)
  if (exact) parts.push(t(lang, `domaine ${exact}`, `domain ${exact}`))
  else if (domains.length) {
    const shown = domains.slice(0, SHOWN_DOMAINS).join(', ') + (domains.length > SHOWN_DOMAINS ? ', …' : '')
    parts.push(t(lang, `fournisseur probable : ${shown}`, `likely provider: ${shown}`))
  } else {
    const start = m.domain[0]
    const end = domainSuffix(m)
    const shape = [start && t(lang, `commençant par « ${start} »`, `starting with "${start}"`), end && t(lang, `finissant par « ${end} »`, `ending with "${end}"`)]
      .filter(Boolean)
      .join(t(lang, ' et ', ' and '))
    parts.push(
      t(lang, `domaine ${shape || 'masqué'} : aucun fournisseur courant (domaine personnel ou professionnel ?)`, `domain ${shape || 'masked'}: no common provider (personal or work domain?)`)
    )
  }
  if (self) parts.push(t(lang, "correspond à l'adresse étudiée", 'matches the address under study'))
  return `${hintLabel(h)} : ${parts.join(', ')}`
}

/** Ce que l'on peut lire d'un téléphone masqué. */
export function describePhone(h: Hint, m: PhoneMask, self: boolean, lang: Lang): string {
  const parts: string[] = []
  if (m.cc) {
    const country = callingCodeLabel(m.cc, lang)
    parts.push(t(lang, `indicatif +${m.cc}`, `country code +${m.cc}`) + (country ? ` (${country})` : ''))
  }
  if (m.leading) parts.push(t(lang, `numéro national commençant par ${m.leading}`, `national number starting with ${m.leading}`))
  if (m.trailing) parts.push(t(lang, `se termine par ${m.trailing}`, `ends with ${m.trailing}`))
  if (!m.leading && !m.trailing) parts.push(t(lang, 'aucun chiffre visible', 'no visible digit'))
  if (self) parts.push(t(lang, 'compatible avec le numéro étudié', 'compatible with the number under study'))
  return `${hintLabel(h)} : ${parts.join(', ')}`
}

export interface Candidate {
  type: 'email' | 'phone'
  value: string
  score: number
  /** Indices compatibles, avec leur source. */
  hints: string[]
  /** D'où vient le candidat, en clair (« construit à partir de « Alice Martin » (prénom.nom) »). */
  basis: string
  origin: 'known' | 'generated'
  status?: Availability
}

export interface Analysis {
  deductions: string[]
  domains: string[]
  candidates: Candidate[]
}

/** Déductions et candidats, sans réseau. Les candidats sont triés, les plus probables d'abord. */
export function analyze(input: InputEntity, lang: Lang): Analysis {
  const hints = hintsOf(input)
  const deductions: string[] = []
  const domains: string[] = []
  const pool = new Map<string, Candidate>()
  const add = (c: Omit<Candidate, 'hints'>, hint: string): void => {
    const prev = pool.get(c.value)
    if (!prev) {
      pool.set(c.value, { ...c, hints: [hint] })
      return
    }
    if (!prev.hints.includes(hint)) prev.hints.push(hint)
    if (c.score < prev.score) Object.assign(prev, { score: c.score, basis: c.basis, origin: c.origin })
  }

  const selfEmail = input.type === 'email' ? input.label.trim().toLowerCase() : undefined
  const selfPhone = input.type === 'phone' ? e164(input.label) : null
  const names = namesOf(input)
  const pseudos = pseudosOf(input)
  const knownEmails = emailsOf(input)
  const knownPhones = phonesOf(input)

  for (const h of hints) {
    const label = hintLabel(h)
    if (h.kind === 'email') {
      const m = parseEmailMask(h.mask)
      if (!m) continue
      const matching = domainsMatching(m, EMAIL_PROVIDERS)
      for (const d of matching.slice(0, SHOWN_DOMAINS)) if (!domains.includes(d)) domains.push(d)
      const self = !!selfEmail && emailMatches(m, selfEmail)
      deductions.push(describeEmail(h, m, matching, self, lang))
      // Sans caractère visible dans la partie locale, tout nom serait « compatible ».
      if (self || localVisible(m) === 0) continue

      for (const e of knownEmails)
        if (emailMatches(m, e)) add({ type: 'email', value: e, score: -3, basis: t(lang, 'adresse déjà présente dans la fiche', 'address already on the record'), origin: 'known' }, label)

      matching.slice(0, MAX_DOMAINS).forEach((domain, di) => {
        const tryLocal = (local: string, score: number, basis: string): void => {
          const email = `${local}@${domain}`
          if (email === selfEmail || !plausibleLocal(local, domain) || !emailMatches(m, email)) return
          add({ type: 'email', value: email, score, basis, origin: 'generated' }, label)
        }
        names.forEach((n, ni) => {
          for (const lp of localPartsFor(n, lang))
            tryLocal(lp.local, lp.rank + 3 * di + ni, t(lang, `construit à partir de « ${n.display} » (${lp.pattern})`, `built from "${n.display}" (${lp.pattern})`))
        })
        pseudos.forEach((p, pi) => tryLocal(p, 1 + 3 * di + pi / 2, t(lang, `construit à partir du pseudo « ${p} »`, `built from the username "${p}"`)))
      })
    } else {
      const m = parsePhoneMask(h.mask, h.country)
      if (!m) continue
      const self = !!selfPhone && phoneMatches(m, selfPhone)
      deductions.push(describePhone(h, m, self, lang))
      for (const p of knownPhones)
        if (phoneMatches(m, p)) add({ type: 'phone', value: p, score: -3, basis: t(lang, 'numéro déjà présent dans la fiche', 'number already on the record'), origin: 'known' }, label)
    }
  }

  // Un candidat compatible avec plusieurs indices est plus probable.
  const candidates = [...pool.values()]
    .map((c) => ({ ...c, score: c.score - 2 * (c.hints.length - 1) }))
    .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value))
  return { deductions, domains, candidates }
}

const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1)

function reason(c: Candidate, lang: Lang): string {
  const parts = [t(lang, `compatible avec ${c.hints.join(' et ')}`, `compatible with ${c.hints.join(' and ')}`), c.basis]
  if (c.status === 'taken')
    parts.push(
      isMicrosoftSignupDomain(domainOf(c.value))
        ? t(lang, 'compte Microsoft existant', 'existing Microsoft account')
        : t(lang, 'adresse utilisée par un compte Microsoft', 'address used by a Microsoft account')
    )
  return parts.join(' ; ')
}

export function toEntity(c: Candidate, lang: Lang): OutEntity {
  return {
    type: c.type,
    label: c.value,
    review: true,
    reviewReason: reason(c, lang),
    linkLabel: c.type === 'email' ? t(lang, 'email possible', 'possible email') : t(lang, 'téléphone possible', 'possible phone'),
    data: compact({
      match_source: c.hints.join(' ; '),
      candidate_basis: c.basis,
      mailbox_exists: c.status === 'taken' && isMicrosoftSignupDomain(domainOf(c.value)) ? true : undefined
    })
  }
}

export default defineModule({
  id: 'hints.crossmatch',
  name: { fr: 'Recoupement des indices masqués', en: 'Masked hint cross-check' },
  description: {
    fr: "Analyse les emails et téléphones masqués de l'entité (a•••••@g•••••.com, +33 •• •• •• •• 42), quelle que soit leur source : première lettre, fournisseur probable, chiffres connus. Propose dans « À vérifier » les adresses compatibles construites à partir des noms et pseudos de la fiche, vérifiées auprès de l'inscription Microsoft sans contacter le titulaire (outlook.com et hotmail.com inexistantes écartées).",
    en: "Analyses the entity's masked emails and phones (a•••••@g•••••.com, +33 •• •• •• •• 42) whatever their source: first letter, likely provider, known digits. Suggests for review the compatible addresses built from the names and usernames on the record, checked against Microsoft sign-up without contacting the owner (non-existent outlook.com and hotmail.com addresses dropped)."
  },
  category: 'email',
  inputTypes: ['*'],
  accepts: (input) => hintsOf(input).length > 0,
  // Après un scan (roso.info, indices de récupération) qui a trouvé des indices masqués.
  followUp: true,
  async run(input, ctx) {
    const lang = ctx.lang
    const { deductions, domains, candidates } = analyze(input, lang)
    if (!deductions.length) return {}

    // Vérification à l'inscription Microsoft. Les autres domaines Microsoft sont réservés :
    // la réponse n'apprendrait rien.
    const pool = candidates.slice(0, POOL)
    const checkable = (c: Candidate): boolean => {
      const d = domainOf(c.value)
      return c.type === 'email' && c.origin === 'generated' && (isMicrosoftSignupDomain(d) || !isMicrosoftConsumerDomain(d))
    }
    const toCheck = pool.filter(checkable).slice(0, MAX_CHECKS)
    let verification: string | undefined
    if (toCheck.length) {
      try {
        await microsoftAvailability(
          ctx,
          toCheck.map((c) => c.value),
          (done, email, status) => {
            const c = toCheck.find((x) => x.value === email)
            if (c) c.status = status
            ctx.progress(done, toCheck.length, email)
          }
        )
      } catch (e) {
        verification = e instanceof Error ? e.message : String(e)
        ctx.log(`vérification Microsoft impossible : ${verification}`)
      }
    }
    // Libre chez Outlook ou Hotmail : l'adresse n'existe pas. Ailleurs, « libre » veut seulement
    // dire qu'aucun compte Microsoft ne l'utilise.
    const kept = pool
      .filter((c) => !(c.status === 'free' && isMicrosoftSignupDomain(domainOf(c.value))))
      .map((c) => ({ ...c, score: c.status === 'taken' ? c.score - 5 : c.score }))
      .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value))
      .slice(0, MAX_CANDIDATES)

    return {
      properties: compact({ hint_deductions: deductions, hint_email_domains: domains.slice(0, 15) }),
      entities: kept.map((c) => toEntity(c, lang)),
      raw: {
        candidates: pool.map((c) => ({ value: c.value, score: c.score, hints: c.hints, origin: c.origin, status: c.status ?? null })),
        ...(verification ? { verification_error: verification } : {})
      }
    }
  }
})
