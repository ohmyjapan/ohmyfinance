// nuxt.config.ts
export default defineNuxtConfig({
  // Development server configuration
  devServer: {
    port: 5000,
    host: '0.0.0.0'
  },

  // Nitro configuration to fix worker entry issues
  nitro: {
    preset: 'node-server',
    esbuild: {
      options: {
        target: 'esnext'
      }
    }
  },

  // Disable SSR temporarily for debugging
  ssr: false,

  // Runtime configuration
  runtimeConfig: {
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ohmyfinance'
  },

  // Modules
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt'
  ],

  // Tailwind CSS configuration
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
    configPath: 'tailwind.config.js'
  },

  // Plugins
  plugins: [
    '~/plugins/i18n.ts'
  ],

  // Component auto-import configuration
  components: {
    dirs: [
      {
        path: '~/components',
        pathPrefix: false
      }
    ]
  },

  // Better handling of modules
  vite: {
    optimizeDeps: {
      include: ['uuid'],
      esbuildOptions: {
        target: 'es2020'
      }
    },
    build: {
      target: 'es2020'
    }
  },

  // Disable typecheck during development
  typescript: {
    shim: true,
    strict: true,
    typeCheck: false
  },

  compatibilityDate: '2025-04-15'
})
