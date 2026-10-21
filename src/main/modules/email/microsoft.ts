import { accountCheck } from './_lib'
import { checkMicrosoft } from './_microsoft'

export default accountCheck({
  id: 'email.microsoft',
  service: 'Microsoft',
  platform: 'microsoft',
  name: { fr: 'Compte Microsoft personnel', en: 'Personal Microsoft account' },
  description: {
    fr: "Vérifie si l'adresse ouvre un compte Microsoft (Outlook, Hotmail, Xbox, Skype) et récupère les moyens de récupération masqués (téléphone, email). Silencieux : aucun code n'est envoyé.",
    en: 'Checks whether the address opens a Microsoft account (Outlook, Hotmail, Xbox, Skype) and reads the masked recovery options (phone, email). Silent: no code is sent.'
  },
  homepage: 'https://login.live.com',
  async check(email, ctx) {
    const r = await checkMicrosoft(ctx, email)
    return { found: r.found, data: r.data, raw: r.raw }
  }
})
