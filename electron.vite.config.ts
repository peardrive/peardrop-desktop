/**
 * electron-vite build configuration.
 *
 * Three bundles:
 *  - main     (src/main)      Node/Electron main process, CommonJS output
 *  - preload  (src/preload)   contextBridge API, CommonJS output
 *  - renderer (src/renderer)  React + Tailwind UI
 *
 * The P2P engine (src/engine) is TypeScript bundled into main. Its runtime
 * dependencies (hyperswarm, corestore, …) stay external — they ship native
 * prebuilds.
 */
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@engine': resolve(__dirname, 'src/engine'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      minify: 'esbuild',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
