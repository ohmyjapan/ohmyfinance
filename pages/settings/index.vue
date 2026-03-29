<template>
  <div>
    <!-- Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <!-- Decorative orbs -->
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>

        <div class="flex items-center gap-4 relative z-10">
          <div class="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
            <Settings2 class="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 class="text-2xl font-bold">{{ t('settings.title') }}</h1>
            <p class="text-primary-light text-sm">{{ t('settings.description') }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="space-y-6">
      <!-- General Settings -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
            <SlidersHorizontal class="w-4 h-4 text-blue-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settings.general') }}</h2>
        </div>
        <div class="p-6 space-y-5">
          <!-- Multi-Currency Toggle -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center">
                <Coins class="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.multiCurrencyMode') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.multiCurrencyDesc') }}</div>
              </div>
            </div>
            <button
              @click="toggleMultiCurrency"
              :class="settings.multiCurrencyEnabled ? 'bg-primary-main' : 'bg-gray-300 dark:bg-gray-600'"
              class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 touch-manipulation"
            >
              <span :class="settings.multiCurrencyEnabled ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300" />
            </button>
          </div>

          <div class="border-t border-gray-100 dark:border-white/5"></div>

          <!-- Dark Mode Toggle -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center">
                <Moon class="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.darkMode') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.darkModeDesc') }}</div>
              </div>
            </div>
            <button
              @click="toggleDarkMode"
              :class="settings.darkMode ? 'bg-primary-main' : 'bg-gray-300 dark:bg-gray-600'"
              class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 touch-manipulation"
            >
              <span :class="settings.darkMode ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300" />
            </button>
          </div>

          <div class="border-t border-gray-100 dark:border-white/5"></div>

          <!-- Default Currency -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center">
                <BadgeJapaneseYen class="w-5 h-5 text-green-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.defaultCurrency') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.defaultCurrencyDesc') }}</div>
              </div>
            </div>
            <select
              v-model="settings.defaultCurrency"
              @change="saveSettings"
              class="border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors touch-manipulation"
            >
              <option value="JPY">JPY - {{ t('currencies.jpy') }}</option>
              <option v-if="settings.multiCurrencyEnabled" value="USD">USD - {{ t('currencies.usd') }}</option>
              <option v-if="settings.multiCurrencyEnabled" value="EUR">EUR - {{ t('currencies.eur') }}</option>
              <option v-if="settings.multiCurrencyEnabled" value="GBP">GBP - {{ t('currencies.gbp') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Notifications -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
            <Bell class="w-4 h-4 text-amber-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settingsPage.notifications') }}</h2>
        </div>
        <div class="p-6 space-y-5">
          <!-- Payment Reminders Toggle -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center">
                <CalendarClock class="w-5 h-5 text-red-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.paymentReminders') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.paymentRemindersDesc') }}</div>
              </div>
            </div>
            <button
              @click="settings.paymentReminders = !settings.paymentReminders; saveSettings()"
              :class="settings.paymentReminders ? 'bg-primary-main' : 'bg-gray-300 dark:bg-gray-600'"
              class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 touch-manipulation"
            >
              <span :class="settings.paymentReminders ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300" />
            </button>
          </div>

          <div class="border-t border-gray-100 dark:border-white/5"></div>

          <!-- Reminder Days -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center">
                <Timer class="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.reminderDays') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.reminderDaysDesc') }}</div>
              </div>
            </div>
            <select
              v-model.number="settings.reminderDays"
              @change="saveSettings"
              class="border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors touch-manipulation"
            >
              <option :value="1">{{ t('settingsPage.day', { n: 1 }) }}</option>
              <option :value="3">{{ t('settingsPage.days', { n: 3 }) }}</option>
              <option :value="7">{{ t('settingsPage.days', { n: 7 }) }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Backup & Restore -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-cyan-500/10 dark:bg-cyan-500/20 flex items-center justify-center">
            <HardDriveDownload class="w-4 h-4 text-cyan-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settingsPage.backupRestore') }}</h2>
        </div>
        <div class="p-6 space-y-5">
          <!-- Download Backup -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-teal-500/10 dark:bg-teal-500/20 flex items-center justify-center">
                <Download class="w-5 h-5 text-teal-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.exportAllData') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.exportAllDataDesc') }}</div>
              </div>
            </div>
            <button
              @click="downloadBackup"
              :disabled="isBackingUp"
              class="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 transition-all duration-300 touch-manipulation"
            >
              <Loader2 v-if="isBackingUp" class="h-4 w-4 animate-spin" />
              <Download v-else class="h-4 w-4" />
              {{ isBackingUp ? t('settingsPage.downloading') : t('settingsPage.downloadBackup') }}
            </button>
          </div>

          <div class="border-t border-gray-100 dark:border-white/5"></div>

          <!-- Restore from Backup -->
          <div>
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-xl bg-sky-500/10 dark:bg-sky-500/20 flex items-center justify-center">
                <Upload class="w-5 h-5 text-sky-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.restoreFromBackup') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.restoreDesc') }}</div>
              </div>
            </div>
            <div class="ml-13 pl-0.5">
              <input
                ref="fileInput"
                type="file"
                accept=".json"
                @change="handleFileSelect"
                class="text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-main/10 file:text-primary-dark dark:file:text-primary-light hover:file:bg-primary-main/20 file:transition-colors file:touch-manipulation"
              />
            </div>
            <div v-if="restoreFile" class="mt-4 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
              <div class="font-medium text-gray-900 dark:text-white mb-3">{{ t('settingsPage.restoreOptions') }}</div>
              <div class="space-y-2">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="restoreOptions.clearExisting" type="checkbox" class="w-4 h-4 rounded border-gray-300 dark:border-white/10 text-primary-main focus:ring-primary-main/50" />
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('settingsPage.clearExisting') }}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="restoreOptions.skipDuplicates" type="checkbox" class="w-4 h-4 rounded border-gray-300 dark:border-white/10 text-primary-main focus:ring-primary-main/50" />
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('settingsPage.skipDuplicates') }}</span>
                </label>
              </div>
              <div class="mt-4 flex gap-3">
                <button
                  @click="performRestore"
                  :disabled="isRestoring"
                  class="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 transition-all duration-300 touch-manipulation"
                >
                  <Loader2 v-if="isRestoring" class="w-4 h-4 animate-spin" />
                  {{ isRestoring ? t('settingsPage.restoring') : t('settingsPage.restoreData') }}
                </button>
                <button
                  @click="cancelRestore"
                  class="px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
                >
                  {{ t('common.cancel') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Restore Result -->
          <div v-if="restoreResult" class="border-t border-gray-100 dark:border-white/5 pt-4">
            <div class="font-medium text-gray-900 dark:text-white mb-2">{{ t('settingsPage.restoreResult') }}</div>
            <div class="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 p-4 rounded-xl text-sm border border-green-200 dark:border-green-800/30">
              {{ restoreResult.message }}
              <div class="mt-2 flex gap-4 font-mono font-bold">
                <span>{{ t('settingsPage.restored') }}: {{ restoreResult.totals?.restored || 0 }}</span>
                <span>{{ t('settingsPage.skipped') }}: {{ restoreResult.totals?.skipped || 0 }}</span>
                <span>{{ t('status.failed') }}: {{ restoreResult.totals?.failed || 0 }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Categories Management -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-violet-500/10 dark:bg-violet-500/20 flex items-center justify-center">
              <Tags class="w-4 h-4 text-violet-500" />
            </div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settingsPage.categories') }}</h2>
          </div>
          <button
            @click="showCategoryModal = true"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-main hover:text-primary-dark dark:text-primary-light dark:hover:text-primary-main transition-colors touch-manipulation"
          >
            <Plus class="h-4 w-4" /> {{ t('settingsPage.addCategory') }}
          </button>
        </div>
        <div class="p-6">
          <div class="flex flex-wrap gap-2">
            <span
              v-for="cat in categories"
              :key="cat.id"
              class="inline-flex items-center px-3 py-1.5 bg-gray-100 dark:bg-white/10 rounded-xl text-sm text-gray-900 dark:text-gray-200 border border-gray-200 dark:border-white/10"
            >
              {{ cat.name }}
              <button @click="deleteCategory(cat.id)" class="ml-2 text-gray-400 hover:text-red-500 transition-colors touch-manipulation">
                <X class="h-3.5 w-3.5" />
              </button>
            </span>
            <span v-if="categories.length === 0" class="text-gray-500 dark:text-gray-400 text-sm">{{ t('settingsPage.noCategories') }}</span>
          </div>
        </div>
      </div>

      <!-- Data Management -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center">
            <Database class="w-4 h-4 text-emerald-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settingsPage.dataManagement') }}</h2>
        </div>
        <div class="p-6 space-y-5">
          <!-- Export Transactions -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                <FileSpreadsheet class="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.exportTransactions') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.exportTransactionsDesc') }}</div>
              </div>
            </div>
            <a
              href="/api/transactions/export?format=csv"
              download
              class="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
            >
              <FileDown class="w-4 h-4" />
              {{ t('settingsPage.exportCsv') }}
            </a>
          </div>

          <div class="border-t border-gray-100 dark:border-white/5"></div>

          <!-- Export Receipts -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-pink-500/10 dark:bg-pink-500/20 flex items-center justify-center">
                <Receipt class="w-5 h-5 text-pink-500" />
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ t('settingsPage.exportReceipts') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('settingsPage.exportReceiptsDesc') }}</div>
              </div>
            </div>
            <a
              href="/api/receipts/export?format=csv"
              download
              class="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
            >
              <FileDown class="w-4 h-4" />
              {{ t('settingsPage.exportCsv') }}
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Category Modal -->
    <div v-if="showCategoryModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-md mx-4 p-6">
        <div class="flex items-center gap-2 mb-6">
          <div class="w-8 h-8 rounded-lg bg-violet-500/10 dark:bg-violet-500/20 flex items-center justify-center">
            <Tags class="w-4 h-4 text-violet-500" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settingsPage.addCategory') }}</h3>
        </div>
        <input
          v-model="newCategoryName"
          type="text"
          :placeholder="t('settingsPage.categoryName')"
          class="w-full border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 mb-4 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
        />
        <div class="flex justify-end gap-3">
          <button
            @click="showCategoryModal = false; newCategoryName = ''"
            class="px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="addCategory"
            class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
          >
            <Plus class="w-4 h-4" />
            {{ t('common.add') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import {
  Settings2,
  SlidersHorizontal,
  Coins,
  Moon,
  BadgeJapaneseYen,
  Bell,
  CalendarClock,
  Timer,
  HardDriveDownload,
  Download,
  Upload,
  Tags,
  Plus,
  X,
  Database,
  FileSpreadsheet,
  FileDown,
  Receipt,
  Loader2
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

const fileInput = ref<HTMLInputElement | null>(null)
const isBackingUp = ref(false)
const isRestoring = ref(false)
const restoreFile = ref<File | null>(null)
const restoreResult = ref<any>(null)
const showCategoryModal = ref(false)
const newCategoryName = ref('')

const settings = reactive({
  multiCurrencyEnabled: false,
  darkMode: false,
  defaultCurrency: 'JPY',
  paymentReminders: true,
  reminderDays: 3
})

const restoreOptions = reactive({
  clearExisting: false,
  skipDuplicates: true
})

const categories = ref<any[]>([])

const loadSettings = () => {
  const saved = localStorage.getItem('ohmyfinance_settings')
  if (saved) {
    Object.assign(settings, JSON.parse(saved))
  }
  applyDarkMode()
}

const saveSettings = () => {
  localStorage.setItem('ohmyfinance_settings', JSON.stringify(settings))
}

const toggleMultiCurrency = () => {
  settings.multiCurrencyEnabled = !settings.multiCurrencyEnabled
  if (!settings.multiCurrencyEnabled) {
    settings.defaultCurrency = 'JPY'
  }
  saveSettings()
}

const toggleDarkMode = () => {
  settings.darkMode = !settings.darkMode
  saveSettings()
  applyDarkMode()
}

const applyDarkMode = () => {
  if (settings.darkMode) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

const downloadBackup = async () => {
  isBackingUp.value = true
  try {
    const response = await fetch('/api/backup?format=download', {
      headers: userStore.authHeader
    })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ohmyfinance_backup_${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Backup failed:', error)
    alert(t('common.error'))
  } finally {
    isBackingUp.value = false
  }
}

const handleFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    restoreFile.value = input.files[0]
    restoreResult.value = null
  }
}

const cancelRestore = () => {
  restoreFile.value = null
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

const performRestore = async () => {
  if (!restoreFile.value) return

  isRestoring.value = true
  try {
    const fileContent = await restoreFile.value.text()
    const data = JSON.parse(fileContent)

    const result = await $fetch('/api/backup/restore', {
      method: 'POST',
      headers: userStore.authHeader,
      body: {
        data,
        clearExisting: restoreOptions.clearExisting,
        skipDuplicates: restoreOptions.skipDuplicates
      }
    })

    restoreResult.value = result
    cancelRestore()
  } catch (error: any) {
    console.error('Restore failed:', error)
    alert(error.data?.statusMessage || t('common.error'))
  } finally {
    isRestoring.value = false
  }
}

const loadCategories = () => {
  const saved = localStorage.getItem('ohmyfinance_categories')
  if (saved) {
    categories.value = JSON.parse(saved)
  }
}

const saveCategories = () => {
  localStorage.setItem('ohmyfinance_categories', JSON.stringify(categories.value))
}

const addCategory = () => {
  if (!newCategoryName.value.trim()) return
  categories.value.push({
    id: Date.now().toString(),
    name: newCategoryName.value.trim()
  })
  saveCategories()
  newCategoryName.value = ''
  showCategoryModal.value = false
}

const deleteCategory = (id: string) => {
  categories.value = categories.value.filter(c => c.id !== id)
  saveCategories()
}

onMounted(() => {
  loadSettings()
  loadCategories()
})
</script>
