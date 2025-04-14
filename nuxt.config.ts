// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
  ],
  build: {
    transpile: ['lucide-vue-next']
  },
  typescript: {
    strict: true
  },
  css: ['~/assets/css/tailwind.css'],
  app: {
    head: {
      title: 'Transaction Middleware',
      meta: [
        { name: 'description', content: 'Transaction management middleware system' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }
      ]
    }
  }
})