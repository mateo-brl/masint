// Traductions : chaque fichier de `src/locales/` exporte `{ fr: {...}, en: {...} }`.
// Les fichiers sont fusionnés, ce qui permet d'ajouter des traductions par fonctionnalité.

import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import type { I18nText, Lang } from '@shared/types'

type Dict = Record<string, unknown>
const files = import.meta.glob<{ default: { fr: Dict; en: Dict } }>('../locales/*.ts', { eager: true })

function deepMerge(a: Dict, b: Dict): Dict {
  const out: Dict = { ...a }
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Dict, v as Dict) : v
  }
  return out
}

let fr: Dict = {}
let en: Dict = {}
for (const f of Object.values(files)) {
  fr = deepMerge(fr, f.default.fr)
  en = deepMerge(en, f.default.en)
}

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnNull: false
})

export default i18n

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
}

/** Langue courante et traduction d'un texte bilingue du catalogue. */
export function useLang(): { lang: Lang; tx: (t: I18nText | undefined) => string } {
  const { i18n: inst } = useTranslation()
  const lang = (inst.language?.startsWith('en') ? 'en' : 'fr') as Lang
  return { lang, tx: (t) => (t ? t[lang] : '') }
}

export function currentLang(): Lang {
  return i18n.language?.startsWith('en') ? 'en' : 'fr'
}
