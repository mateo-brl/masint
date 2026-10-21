import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }
// MASINT_OUT permet de construire dans un autre dossier que out/ (builds parallèles, tests).
const outBase = resolve(__dirname, process.env.MASINT_OUT || 'out')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { outDir: resolve(outBase, 'main') }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { outDir: resolve(outBase, 'preload') }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        ...shared,
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(outBase, 'renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
