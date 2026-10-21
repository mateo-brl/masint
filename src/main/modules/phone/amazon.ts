import { accountCheck } from '../email/_lib'
import { checkAmazon } from '../email/_amazon'
import { toE164 } from './_phone'

export default accountCheck({
  id: 'phone.amazon',
  service: 'Amazon',
  platform: 'amazon',
  inputTypes: ['phone'],
  description: {
    fr: "Vérifie si le numéro est l'identifiant d'un compte Amazon via la première étape de connexion et récupère le numéro masqué proposé. Silencieux : aucun SMS n'est envoyé.",
    en: 'Checks whether the number is the sign-in name of an Amazon account using the first sign-in step and reads the masked number shown. Silent: no SMS is sent.'
  },
  homepage: 'https://www.amazon.com',
  timeoutMs: 60000,
  async check(_value, ctx, input) {
    const e164 = toE164(input)
    const r = await checkAmazon(ctx, e164)
    return { found: r.found, label: e164, data: { recovery_hints: r.hints }, raw: r.raw }
  }
})
