// Enquêtes importées depuis l'explorateur (double-clic sur un .masint) en attente
// d'ouverture : l'interface les récupère quand elle est prête, ce qui évite de
// perdre l'événement si elle n'écoute pas encore.

const pending: string[] = []

export function queueOpen(id: string): void {
  pending.push(id)
}

export function takePendingOpen(): string[] {
  return pending.splice(0)
}
