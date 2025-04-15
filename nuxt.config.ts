// nuxt.config.ts
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Get the current module's directory
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  // Your existing configuration

  // Fix for ESM path issues on Windows
  alias: {
    // Define aliases to avoid absolute path issues
    '~': resolve(__dirname),
    '@': resolve(__dirname)
  },

  vite: {
    resolve: {
      alias: {
        // Ensure these aliases work in Vite
        '~': resolve(__dirname),
        '@': resolve(__dirname)
      }
    },
    // Better handling of modules
    optimizeDeps: {
      include: ['uuid'],
      exclude: [],
      esbuildOptions: {
        target: 'es2020'
      }
    },
    build: {
      target: 'es2020',
      // Fix for ESM issues
      rollupOptions: {
        // Properly externalize dependencies
        external: [],
        output: {
          format: 'es'
        }
      }
    }
  },

  // Disable typecheck during development to avoid ESM issues
  typescript: {
    shim: true,
    strict: true,
    typeCheck: false
  },

  compatibilityDate: '2025-04-15'
})