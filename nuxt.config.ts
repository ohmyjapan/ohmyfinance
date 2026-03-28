// nuxt.config.ts
export default defineNuxtConfig({
  // Development server configuration
  devServer: {
    port: 8080,
    host: '0.0.0.0'
  },

  // Nitro configuration to fix worker entry issues
  nitro: {
    preset: 'node-server',
    rollupConfig: {
      external: ['papaparse', 'yahoo-finance2', '@google/generative-ai']
    },
    esbuild: {
      options: {
        target: 'esnext'
      }
    },
    routeRules: {
      '/api/**': {
        headers: {
          'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || 'http://localhost:8080',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true'
        }
      }
    }
  },

  // Disable SSR temporarily for debugging
  ssr: false,

  // Runtime configuration
  runtimeConfig: {
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ohmyfinance'
  },

  // Google Fonts
  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap' }
      ]
    }
  },

  // Modules
  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@nuxtjs/i18n'
  ],

  // Pinia configuration - auto-import stores
  pinia: {
    storesDirs: ['./stores/**']
  },

  // Auto-imports configuration
  imports: {
    dirs: ['stores']
  },

  // i18n configuration
  i18n: {
    locales: [
      { code: 'ja', iso: 'ja-JP', file: 'ja.json', name: '日本語' },
      { code: 'ko', iso: 'ko-KR', file: 'ko.json', name: '한국어' }
    ],
    defaultLocale: 'ja',
    lazy: false,
    langDir: 'locales',
    strategy: 'prefix_except_default',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
      alwaysRedirect: false
    },
    vueI18n: './i18n.config.ts',
    bundle: {
      fullInstall: true
    }
  },

  // Tailwind CSS configuration
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
    configPath: 'tailwind.config.js'
  },

  // Plugins
  plugins: [],

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
