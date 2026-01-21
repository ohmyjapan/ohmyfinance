// stores/theme.ts
import { defineStore } from 'pinia'

interface ThemeState {
  isDark: boolean
}

export const useThemeStore = defineStore('theme', {
  state: (): ThemeState => ({
    isDark: false
  }),

  actions: {
    toggleTheme() {
      this.isDark = !this.isDark
      this.applyTheme()
    },

    initTheme() {
      if (process.client) {
        const savedTheme = localStorage.getItem('theme')
        if (savedTheme) {
          this.isDark = savedTheme === 'dark'
        } else {
          this.isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        }
        this.applyTheme()
      }
    },

    applyTheme() {
      if (process.client) {
        if (this.isDark) {
          document.documentElement.classList.add('dark')
          localStorage.setItem('theme', 'dark')
        } else {
          document.documentElement.classList.remove('dark')
          localStorage.setItem('theme', 'light')
        }
      }
    }
  }
})
