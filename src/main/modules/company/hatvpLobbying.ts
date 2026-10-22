// Répertoire des représentants d'intérêts de la HATVP : catégorie, dernier exercice déclaré
// (dépenses, salariés, actions, domaines) et lien vers la fiche de l'organisation.

import { defineModule } from '@shared/modules'
import { AGORA_URL, cached, download, lobbyingOutput, parseAgora, type AgoraOrganisation } from '../person/_hatvp'

export default defineModule({
  id: 'company.hatvp_lobbying',
  name: { fr: 'Représentant d’intérêts (HATVP)', en: 'Registered lobbyist (HATVP)' },
  description: {
    fr: 'Cherche l’entreprise ou l’organisation dans le répertoire des représentants d’intérêts de la HATVP (fichier open data, cache 24 h) : catégorie, date d’inscription, dernier exercice déclaré (dépenses, salariés, nombre d’actions, domaines et objets) et lien vers la fiche. SIREN identique : propriétés ajoutées à la fiche ; nom identique sans SIREN : mis de côté dans « À vérifier ».',
    en: 'Looks the company or organization up in the HATVP lobbyist register (open data file, 24 h cache): category, registration date, latest declared year (spending, staff, number of actions, topics and purposes) and link to the register page. Same SIREN: properties added to the record; same name without SIREN: put aside in "To review".'
  },
  category: 'company',
  inputTypes: ['company', 'organization'],
  homepage: 'https://www.hatvp.fr/le-repertoire/',
  experimental: true,
  timeoutMs: 240000,
  async run(input, ctx) {
    ctx.progress(0, 1, 'HATVP')
    const list = await cached('agora', async () => parseAgora(JSON.parse(await download(ctx, AGORA_URL, 180000)) as { publications?: AgoraOrganisation[] }))
    ctx.progress(1, 1, 'HATVP')
    return lobbyingOutput(ctx, list, input)
  }
})
