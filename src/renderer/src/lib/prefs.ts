// Préférences d'affichage propres à ce poste (panneau ouvert, filtres). Stockage local :
// en cas d'échec de lecture ou d'écriture, la valeur par défaut s'applique.

const PREFIX = 'masint.'

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* stockage indisponible : la préférence ne sera pas retenue */
  }
}
