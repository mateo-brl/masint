import { accountCheck } from '../email/_lib'
import { checkMicrosoft } from '../email/_microsoft'
import { toE164 } from './_phone'

export default accountCheck({
  id: 'phone.microsoft',
  service: 'Microsoft',
  platform: 'microsoft',
  inputTypes: ['phone'],
  name: { fr: 'Compte Microsoft personnel', en: 'Personal Microsoft account' },
  description: {
    fr: "Vérifie si le numéro sert d'identifiant à un compte Microsoft (Outlook, Xbox, Skype) et récupère les moyens de récupération masqués. Silencieux : aucun SMS n'est envoyé.",
    en: 'Checks whether the number is the sign-in name of a Microsoft account (Outlook, Xbox, Skype) and reads the masked recovery options. Silent: no SMS is sent.'
  },
  homepage: 'https://login.live.com',
  async check(_value, ctx, input) {
    const e164 = toE164(input)
    const r = await checkMicrosoft(ctx, e164)
    return { found: r.found, label: e164, data: r.data, raw: r.raw }
  }
})
