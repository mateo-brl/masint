// Lance les tests du moteur (tests/core/**) avec Electron en mode Node.
// better-sqlite3 est compilé pour l'ABI d'Electron (postinstall : electron-builder
// install-app-deps) : ces tests ne peuvent donc pas tourner sous le Node du système.
// Fonctionne sous Windows et Linux, sans affichage (ELECTRON_RUN_AS_NODE=1).
//
// Usage : npm run test:core [-- arguments vitest supplémentaires]

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// Le paquet `electron` renvoie le chemin absolu du binaire (electron.exe sous Windows).
const electron = require('electron')
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const args = [vitest, 'run', '--config', 'vitest.core.config.ts', ...process.argv.slice(2)]

const child = spawn(electron, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (err) => {
  console.error('[test:core] impossible de lancer Electron :', err.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[test:core] Electron interrompu par le signal ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
