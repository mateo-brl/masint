import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests qui utilisent better-sqlite3 (compilé pour Electron) : lancés via Electron en mode Node.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['tests/core/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks'
  }
})
