import { defineModule, type ModuleOutput } from '@shared/modules'
import { emailProvider } from '@shared/platforms'
import { accountEntity, compact, requireEmail, tr } from './_lib'
import { checkEntra } from './_microsoft'

export default defineModule({
  id: 'email.office365',
  name: { fr: 'Compte Microsoft 365 (pro)', en: 'Microsoft 365 account (work)' },
  description: {
    fr: "Vérifie si une adresse professionnelle existe dans l'annuaire Microsoft Entra ID (Microsoft 365) et indique le fournisseur d'identité quand le domaine est fédéré (Okta, ADFS...).",
    en: 'Checks whether a work address exists in the Microsoft Entra ID (Microsoft 365) directory and reports the identity provider when the domain is federated (Okta, ADFS...).'
  },
  category: 'email',
  inputTypes: ['email'],
  homepage: 'https://login.microsoftonline.com',
  // Les webmails grand public sont couverts par le module « Compte Microsoft personnel ».
  accepts: (input) => !emailProvider(input.label),
  async run(input, ctx): Promise<ModuleOutput> {
    const email = requireEmail(input)
    const r = await checkEntra(ctx, email)
    if (r.tenant === 'federated') {
      return {
        properties: compact({ m365_tenant: 'federated', identity_provider: r.identityProvider }),
        raw: r.raw
      }
    }
    if (!r.found) return { found: false, properties: compact({ m365_tenant: r.tenant === 'managed' ? 'managed' : undefined }), raw: r.raw }
    return {
      found: true,
      properties: { m365_tenant: r.tenant },
      entities: [
        // Libellé distinct du compte personnel, qui peut coexister avec la même adresse.
        accountEntity('microsoft', 'Microsoft 365', `${email} (Microsoft 365)`, {
          data: { kind: 'Microsoft 365 / Entra ID' },
          linkLabel: tr(ctx, 'compte Microsoft 365', 'Microsoft 365 account')
        })
      ],
      raw: r.raw
    }
  }
})
