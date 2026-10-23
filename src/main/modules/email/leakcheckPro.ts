// LeakCheck avec la clé de l'utilisateur (API Pro v2) : emails, pseudos et noms associés à
// l'adresse dans les fuites, jamais les mots de passe. Voir `_leakcheckPro.ts`.

import { defineModule } from '@shared/modules'
import { requireEmail } from './_lib'
import { LEAKCHECK_KEY, leakcheckPro } from './_leakcheckPro'

export default defineModule({
  id: 'email.leakcheck_pro',
  name: { fr: 'Fuites de données (LeakCheck Pro)', en: 'Data breaches (LeakCheck Pro)' },
  description: {
    fr: "Avec une clé LeakCheck (API Pro v2) : lignes des fuites qui contiennent l'adresse. Seuls l'email, le pseudo, le nom, la date de naissance et l'adresse postale sont lus ; mots de passe, empreintes et sels sont écartés dès la réception, jamais stockés. Emails, pseudos et noms associés vont dans « À vérifier » avec la fuite qui les relie (20 au plus). Une requête du quota LeakCheck par lancement.",
    en: 'With a LeakCheck key (Pro API v2): rows of the leaks containing the address. Only the email, username, name, birth date and postal address are read; passwords, hashes and salts are dropped on receipt, never stored. Linked emails, usernames and names go to "To review" with the leak that ties them (20 at most). One query of the LeakCheck quota per run.'
  },
  category: 'email',
  inputTypes: ['email'],
  keys: [LEAKCHECK_KEY],
  // Quota payant : seulement sur demande.
  ondemand: true,
  homepage: 'https://leakcheck.io',
  async run(input, ctx) {
    const email = requireEmail(input)
    return leakcheckPro(ctx, { kind: 'email', value: email }, email)
  }
})
