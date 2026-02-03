import { defineStore } from 'pinia'

export interface AppSettings {
  // Currency settings
  defaultCurrency: string
  multiCurrencyEnabled: boolean

  // Display settings
  dateFormat: string
  language: string
  theme: 'light' | 'dark' | 'system'

  // Notification settings
  emailNotifications: boolean
  paymentReminders: boolean
  reminderDaysBefore: number
}

interface SettingsState {
  settings: AppSettings
  isLoading: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultCurrency: 'JPY',
  multiCurrencyEnabled: false,
  dateFormat: 'YYYY-MM-DD',
  language: 'en',
  theme: 'system',
  emailNotifications: true,
  paymentReminders: true,
  reminderDaysBefore: 3
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    settings: { ...DEFAULT_SETTINGS },
    isLoading: false
  }),

  getters: {
    defaultCurrency: (state) => state.settings.defaultCurrency,
    isMultiCurrencyEnabled: (state) => state.settings.multiCurrencyEnabled,
    currentTheme: (state) => state.settings.theme
  },

  actions: {
    // Initialize settings from localStorage
    initSettings() {
      if (process.client) {
        const savedSettings = localStorage.getItem('app_settings')
        if (savedSettings) {
          try {
            const parsed = JSON.parse(savedSettings)
            this.settings = { ...DEFAULT_SETTINGS, ...parsed }
          } catch (err) {
            console.error('Failed to parse settings from localStorage')
          }
        }
      }
    },

    // Update a single setting
    updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
      this.settings[key] = value
      this.saveSettings()
    },

    // Update multiple settings
    updateSettings(updates: Partial<AppSettings>) {
      this.settings = { ...this.settings, ...updates }
      this.saveSettings()
    },

    // Toggle multi-currency mode
    toggleMultiCurrency() {
      this.settings.multiCurrencyEnabled = !this.settings.multiCurrencyEnabled
      this.saveSettings()
    },

    // Save settings to localStorage
    saveSettings() {
      if (process.client) {
        localStorage.setItem('app_settings', JSON.stringify(this.settings))
      }
    },

    // Reset to defaults
    resetSettings() {
      this.settings = { ...DEFAULT_SETTINGS }
      this.saveSettings()
    }
  }
})
