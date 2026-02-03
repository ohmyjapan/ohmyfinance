<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800">{{ t('settings.title') }}</h1>
      <p class="text-gray-600">{{ t('settings.description') }}</p>
    </header>

    <div class="space-y-6">
      <!-- General Settings -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">{{ t('settings.general') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.multiCurrencyMode') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.multiCurrencyDesc') }}</div>
            </div>
            <button
              @click="toggleMultiCurrency"
              :class="settings.multiCurrencyEnabled ? 'bg-purple-600' : 'bg-gray-300'"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            >
              <span :class="settings.multiCurrencyEnabled ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" />
            </button>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.darkMode') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.darkModeDesc') }}</div>
            </div>
            <button
              @click="toggleDarkMode"
              :class="settings.darkMode ? 'bg-purple-600' : 'bg-gray-300'"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            >
              <span :class="settings.darkMode ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" />
            </button>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.defaultCurrency') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.defaultCurrencyDesc') }}</div>
            </div>
            <select v-model="settings.defaultCurrency" @change="saveSettings" class="border border-gray-300 rounded-md px-3 py-2">
              <option value="JPY">JPY - {{ t('currencies.jpy') }}</option>
              <option v-if="settings.multiCurrencyEnabled" value="USD">USD - {{ t('currencies.usd') }}</option>
              <option v-if="settings.multiCurrencyEnabled" value="EUR">EUR - {{ t('currencies.eur') }}</option>
              <option v-if="settings.multiCurrencyEnabled" value="GBP">GBP - {{ t('currencies.gbp') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Notifications -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">{{ t('settingsPage.notifications') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.paymentReminders') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.paymentRemindersDesc') }}</div>
            </div>
            <button
              @click="settings.paymentReminders = !settings.paymentReminders; saveSettings()"
              :class="settings.paymentReminders ? 'bg-purple-600' : 'bg-gray-300'"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            >
              <span :class="settings.paymentReminders ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" />
            </button>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.reminderDays') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.reminderDaysDesc') }}</div>
            </div>
            <select v-model.number="settings.reminderDays" @change="saveSettings" class="border border-gray-300 rounded-md px-3 py-2">
              <option :value="1">{{ t('settingsPage.day', { n: 1 }) }}</option>
              <option :value="3">{{ t('settingsPage.days', { n: 3 }) }}</option>
              <option :value="7">{{ t('settingsPage.days', { n: 7 }) }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Backup & Restore -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">{{ t('settingsPage.backupRestore') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.exportAllData') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.exportAllDataDesc') }}</div>
            </div>
            <button @click="downloadBackup" :disabled="isBackingUp" class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50">
              <Download class="h-4 w-4 inline mr-2" />
              {{ isBackingUp ? t('settingsPage.downloading') : t('settingsPage.downloadBackup') }}
            </button>
          </div>
          <div class="border-t border-gray-200 pt-4">
            <div class="font-medium text-gray-700 mb-2">{{ t('settingsPage.restoreFromBackup') }}</div>
            <div class="text-sm text-gray-500 mb-3">{{ t('settingsPage.restoreDesc') }}</div>
            <div class="flex items-center space-x-4">
              <input
                ref="fileInput"
                type="file"
                accept=".json"
                @change="handleFileSelect"
                class="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
              />
            </div>
            <div v-if="restoreFile" class="mt-4 p-4 bg-gray-50 rounded-md">
              <div class="font-medium text-gray-700 mb-2">{{ t('settingsPage.restoreOptions') }}</div>
              <div class="space-y-2">
                <label class="flex items-center">
                  <input v-model="restoreOptions.clearExisting" type="checkbox" class="mr-2" />
                  <span class="text-sm text-gray-600">{{ t('settingsPage.clearExisting') }}</span>
                </label>
                <label class="flex items-center">
                  <input v-model="restoreOptions.skipDuplicates" type="checkbox" class="mr-2" />
                  <span class="text-sm text-gray-600">{{ t('settingsPage.skipDuplicates') }}</span>
                </label>
              </div>
              <div class="mt-4 flex space-x-3">
                <button @click="performRestore" :disabled="isRestoring" class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50">
                  {{ isRestoring ? t('settingsPage.restoring') : t('settingsPage.restoreData') }}
                </button>
                <button @click="cancelRestore" class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                  {{ t('common.cancel') }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="restoreResult" class="border-t border-gray-200 pt-4">
            <div class="font-medium text-gray-700 mb-2">{{ t('settingsPage.restoreResult') }}</div>
            <div class="bg-green-50 text-green-700 p-3 rounded-md text-sm">
              {{ restoreResult.message }}
              <div class="mt-2">
                <span class="font-medium">{{ t('settingsPage.restored') }}:</span> {{ restoreResult.totals?.restored || 0 }} |
                <span class="font-medium">{{ t('settingsPage.skipped') }}:</span> {{ restoreResult.totals?.skipped || 0 }} |
                <span class="font-medium">{{ t('status.failed') }}:</span> {{ restoreResult.totals?.failed || 0 }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Categories Management -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 class="text-lg font-medium text-gray-800">{{ t('settingsPage.categories') }}</h2>
          <button @click="showCategoryModal = true" class="text-purple-600 hover:text-purple-700 text-sm font-medium">
            <Plus class="h-4 w-4 inline mr-1" /> {{ t('settingsPage.addCategory') }}
          </button>
        </div>
        <div class="p-6">
          <div class="flex flex-wrap gap-2">
            <span v-for="cat in categories" :key="cat.id" class="inline-flex items-center px-3 py-1 bg-gray-100 rounded-full text-sm">
              {{ cat.name }}
              <button @click="deleteCategory(cat.id)" class="ml-2 text-gray-400 hover:text-red-500">
                <X class="h-3 w-3" />
              </button>
            </span>
            <span v-if="categories.length === 0" class="text-gray-500 text-sm">{{ t('settingsPage.noCategories') }}</span>
          </div>
        </div>
      </div>

      <!-- Data Management -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">{{ t('settingsPage.dataManagement') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.exportTransactions') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.exportTransactionsDesc') }}</div>
            </div>
            <a href="/api/transactions/export?format=csv" download class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              {{ t('settingsPage.exportCsv') }}
            </a>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700">{{ t('settingsPage.exportReceipts') }}</div>
              <div class="text-sm text-gray-500">{{ t('settingsPage.exportReceiptsDesc') }}</div>
            </div>
            <a href="/api/receipts/export?format=csv" download class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              {{ t('settingsPage.exportCsv') }}
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Category Modal -->
    <div v-if="showCategoryModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h3 class="text-lg font-medium text-gray-900 mb-4">{{ t('settingsPage.addCategory') }}</h3>
        <input v-model="newCategoryName" type="text" :placeholder="t('settingsPage.categoryName')" class="w-full border border-gray-300 rounded-md px-3 py-2 mb-4" />
        <div class="flex justify-end space-x-3">
          <button @click="showCategoryModal = false; newCategoryName = ''" class="px-4 py-2 border border-gray-300 rounded-md text-gray-700">{{ t('common.cancel') }}</button>
          <button @click="addCategory" class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700">{{ t('common.add') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Download, Plus, X } from 'lucide-vue-next'

const { t } = useI18n()

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
    const response = await fetch('/api/backup?format=download')
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
