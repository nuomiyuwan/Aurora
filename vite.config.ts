import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const { createEmbyDevMiddleware } = require('./electron/embyDevMiddleware.cjs')
const packageMetadata = require('./package.json') as { version: string }

function embyDevBridgePlugin(): Plugin {
  return {
    name: 'aurora-emby-dev-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createEmbyDevMiddleware({
        allowedOrigin: 'http://127.0.0.1:5174',
        allowedHost: '127.0.0.1:5174',
      }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: {
    __AURORA_VERSION__: JSON.stringify(packageMetadata.version),
  },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three-vendor',
              test: /node_modules[\\/]three[\\/]/,
            },
          ],
        },
      },
    },
    // Aurora deliberately keeps both the standard and WebKit-prefixed glass
    // declarations. Vite 8's default CSS minifier currently collapses the
    // pair to only -webkit-backdrop-filter, which Electron Chromium rejects.
    cssMinify: false,
  },
  plugins: [react(), embyDevBridgePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
})
