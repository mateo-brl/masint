// Notes de version des mises à jour, mises en texte simple pour la fenêtre de mise à jour.

/**
 * Notes de version en texte simple : le flux GitHub les donne en HTML. Les titres deviennent
 * « ## », les éléments de liste « - », le reste est du texte sans balise.
 */
export function releaseNotesText(notes: unknown): string | undefined {
  const raw = Array.isArray(notes)
    ? notes.map((n: { note?: string | null }) => n?.note ?? '').join('\n')
    : typeof notes === 'string'
      ? notes
      : ''
  const text = raw
    .replace(/\r/g, '')
    .replace(/<h[1-6][^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|ul|ol|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return text ? text.slice(0, 8000) : undefined
}
