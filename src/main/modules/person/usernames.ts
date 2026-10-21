import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { compactPart, initials, splitName, type PersonName } from './_name'

/** Pseudos les plus courants construits à partir d'un prénom et d'un nom, du plus probable au moins probable. */
export function candidateUsernames(n: PersonName, limit = 10): Array<{ username: string; pattern: string }> {
  const f = compactPart(n.firstNames[0])
  const l = compactPart(n.lastName)
  if (!f || !l) return []
  const fi = initials(n.firstNames[0])
  const li = l.charAt(0)
  const list: Array<[string, string]> = [
    [f + l, 'prenomnom'],
    [`${f}.${l}`, 'prenom.nom'],
    [fi + l, 'pnom'],
    [`${f}_${l}`, 'prenom_nom'],
    [l + f, 'nomprenom'],
    [`${fi}.${l}`, 'p.nom'],
    [`${l}.${f}`, 'nom.prenom'],
    [`${fi}_${l}`, 'p_nom'],
    [`${f}-${l}`, 'prenom-nom'],
    [l + fi, 'nomp'],
    [f + li, 'prenomn'],
    [`${l}_${f}`, 'nom_prenom']
  ]
  const seen = new Set<string>()
  const out: Array<{ username: string; pattern: string }> = []
  for (const [username, pattern] of list) {
    if (seen.has(username) || username.length < 3) continue
    seen.add(username)
    out.push({ username, pattern })
    if (out.length >= limit) break
  }
  return out
}

export default defineModule({
  id: 'person.usernames',
  name: { fr: 'Pseudos probables', en: 'Likely usernames' },
  description: {
    fr: 'Génère hors ligne les dix pseudos les plus courants à partir du prénom et du nom (jeandupont, jean.dupont, jdupont, dupontjean...), à vérifier ensuite avec les modules de pseudo.',
    en: 'Generates offline the ten most common usernames from the first and last name (jeandupont, jean.dupont, jdupont, dupontjean...), to be checked with the username modules.'
  },
  category: 'person',
  inputTypes: ['person'],
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const candidates = candidateUsernames(name)
    const entities: OutEntity[] = candidates.map((c) => ({
      type: 'username',
      label: c.username,
      data: { pattern: c.pattern, generated: true },
      linkLabel: ctx.lang === 'fr' ? 'pseudo possible' : 'possible username'
    }))
    return { entities, raw: { first_names: name.firstNames, last_name: name.lastName, candidates } }
  }
})
