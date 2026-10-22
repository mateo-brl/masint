// Déclarations d'intérêts et de patrimoine publiées en ligne par la HATVP : responsables
// publics de même nom, mis de côté dans « À vérifier » (le fichier ne publie pas la naissance).

import { defineModule, ModuleError } from '@shared/modules'
import { cached, declarationsOutput, download, LISTE_URL, parseListe } from './_hatvp'
import { splitName } from './_name'

export default defineModule({
  id: 'person.hatvp',
  name: { fr: 'Déclarations à la HATVP', en: 'HATVP declarations' },
  description: {
    fr: 'Cherche la personne parmi les responsables publics dont les déclarations d’intérêts ou de patrimoine sont publiées en ligne par la HATVP (fichier open data, cache 24 h) : mandat, qualité, déclarations et lien vers la page nominative. Le fichier ne publie pas la date de naissance : chaque responsable trouvé est mis de côté dans « À vérifier ».',
    en: 'Looks the person up among public officials whose declarations of interests or assets are published online by the HATVP (open data file, 24 h cache): mandate, role, declarations and link to the official’s page. The file has no birth date: every official found is put aside in "To review".'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.hatvp.fr/open-data/',
  experimental: true,
  timeoutMs: 180000,
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    ctx.progress(0, 1, 'HATVP')
    const list = await cached('liste', async () => parseListe(await download(ctx, LISTE_URL, 90000)))
    ctx.progress(1, 1, 'HATVP')
    return declarationsOutput(ctx, list, name)
  }
})
