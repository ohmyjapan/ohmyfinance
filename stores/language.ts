// stores/language.ts
import { defineStore } from 'pinia'

export type Language = 'en' | 'ko' | 'ja'

interface LanguageState {
  current: Language
}

export const useLanguageStore = defineStore('language', {
  state: (): LanguageState => ({
    current: 'en'
  }),

  actions: {
    setLanguage(lang: Language) {
      this.current = lang
      if (process.client) {
        localStorage.setItem('preferredLanguage', lang)
      }
    },

    initLanguage() {
      if (process.client) {
        const forcedLang = localStorage.getItem('forcedLanguage') as Language
        if (forcedLang && ['en', 'ko', 'ja'].includes(forcedLang)) {
          this.current = forcedLang
          return
        }

        const savedLang = localStorage.getItem('preferredLanguage') as Language
        if (savedLang && ['en', 'ko', 'ja'].includes(savedLang)) {
          this.current = savedLang
          return
        }

        const browserLang = navigator.language.split('-')[0]
        if (['en', 'ko', 'ja'].includes(browserLang)) {
          this.current = browserLang as Language
        }
      }
    }
  }
})
