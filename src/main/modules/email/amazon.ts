import { accountCheck } from './_lib'
import { checkAmazon } from './_amazon'

export default accountCheck({
  id: 'email.amazon',
  service: 'Amazon',
  platform: 'amazon',
  description: {
    fr: "Vérifie si l'adresse est l'identifiant d'un compte Amazon via la première étape de connexion. Silencieux : aucun code n'est envoyé.",
    en: 'Checks whether the address is the sign-in name of an Amazon account using the first sign-in step. Silent: no code is sent.'
  },
  homepage: 'https://www.amazon.com',
  timeoutMs: 60000,
  async check(email, ctx) {
    const r = await checkAmazon(ctx, email)
    return { found: r.found, data: { recovery_hints: r.hints }, raw: r.raw }
  }
})
