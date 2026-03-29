<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800 dark:text-white">{{ t('nav.apiConfiguration') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">Manage API keys and webhook settings</p>
    </header>

    <div class="space-y-6">
      <!-- API Keys -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-white">API Keys</h2>
        </div>
        <div class="p-6 space-y-4">
          <div v-if="apiKeys.length === 0" class="text-center py-8">
            <Key class="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p class="text-gray-500 dark:text-gray-400 text-sm">No API keys created yet</p>
            <button
              @click="showCreateKeyModal = true"
              class="mt-4 px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark text-sm font-medium touch-manipulation"
            >
              <Plus class="h-4 w-4 inline mr-1" />
              Create API Key
            </button>
          </div>
          <div v-else>
            <div
              v-for="key in apiKeys"
              :key="key.id"
              class="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5 last:border-b-0"
            >
              <div>
                <div class="font-medium text-gray-700 dark:text-gray-200 text-sm">{{ key.name }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">{{ key.maskedKey }}</div>
                <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Created {{ formatDate(key.createdAt) }}
                  <span v-if="key.lastUsed"> &middot; Last used {{ formatDate(key.lastUsed) }}</span>
                </div>
              </div>
              <button
                @click="deleteApiKey(key.id)"
                class="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
            <button
              @click="showCreateKeyModal = true"
              class="mt-4 px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark text-sm font-medium touch-manipulation"
            >
              <Plus class="h-4 w-4 inline mr-1" />
              Create API Key
            </button>
          </div>
        </div>
      </div>

      <!-- Webhooks -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-white">Webhooks</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700 dark:text-gray-200">Transaction Webhook</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Receive notifications when transactions are created or updated</div>
            </div>
            <button
              @click="webhookSettings.transactionEnabled = !webhookSettings.transactionEnabled; saveWebhookSettings()"
              :class="webhookSettings.transactionEnabled ? 'bg-primary-main' : 'bg-gray-300 dark:bg-gray-600'"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            >
              <span :class="webhookSettings.transactionEnabled ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" />
            </button>
          </div>
          <div v-if="webhookSettings.transactionEnabled" class="pl-0 mt-2">
            <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Webhook URL</label>
            <input
              v-model="webhookSettings.transactionUrl"
              type="url"
              placeholder="https://example.com/webhook"
              @blur="saveWebhookSettings"
              class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-md px-3 py-2 text-sm focus:border-primary-main focus:ring-primary-main"
            />
          </div>

          <div class="border-t border-gray-200 dark:border-white/10 pt-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-medium text-gray-700 dark:text-gray-200">Invoice Webhook</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">Receive notifications for invoice status changes</div>
              </div>
              <button
                @click="webhookSettings.invoiceEnabled = !webhookSettings.invoiceEnabled; saveWebhookSettings()"
                :class="webhookSettings.invoiceEnabled ? 'bg-primary-main' : 'bg-gray-300 dark:bg-gray-600'"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              >
                <span :class="webhookSettings.invoiceEnabled ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" />
              </button>
            </div>
            <div v-if="webhookSettings.invoiceEnabled" class="pl-0 mt-2">
              <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Webhook URL</label>
              <input
                v-model="webhookSettings.invoiceUrl"
                type="url"
                placeholder="https://example.com/webhook"
                @blur="saveWebhookSettings"
                class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-md px-3 py-2 text-sm focus:border-primary-main focus:ring-primary-main"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- API Documentation Link -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-white">API Documentation</h2>
        </div>
        <div class="p-6">
          <div class="flex items-start gap-3">
            <FileText class="h-5 w-5 text-gray-400 dark:text-gray-500 mt-0.5" />
            <div>
              <p class="text-sm text-gray-600 dark:text-gray-300">
                Use the OhMyFinance API to integrate your financial data with external services.
                The API supports transaction management, invoice operations, and receipt processing.
              </p>
              <div class="mt-3 flex items-center gap-2 text-sm">
                <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium">
                  Base URL
                </span>
                <code class="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded">
                  /api/v1
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create API Key Modal -->
    <div v-if="showCreateKeyModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-md mx-4 p-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">Create API Key</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Key Name</label>
            <input
              v-model="newKeyName"
              type="text"
              placeholder="e.g. Production, Development"
              class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-md px-3 py-2 text-sm focus:border-primary-main focus:ring-primary-main"
            />
          </div>
        </div>
        <div class="flex justify-end space-x-3 mt-6">
          <button
            @click="showCreateKeyModal = false; newKeyName = ''"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07] text-sm"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="createApiKey"
            class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark text-sm"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Key, Plus, Trash2, FileText } from 'lucide-vue-next'

const { t } = useI18n()

const showCreateKeyModal = ref(false)
const newKeyName = ref('')

interface ApiKey {
  id: string
  name: string
  maskedKey: string
  createdAt: string
  lastUsed: string | null
}

const apiKeys = ref<ApiKey[]>([])

const webhookSettings = reactive({
  transactionEnabled: false,
  transactionUrl: '',
  invoiceEnabled: false,
  invoiceUrl: ''
})

const loadSettings = () => {
  const saved = localStorage.getItem('ohmyfinance_api_settings')
  if (saved) {
    const parsed = JSON.parse(saved)
    if (parsed.apiKeys) apiKeys.value = parsed.apiKeys
    if (parsed.webhooks) Object.assign(webhookSettings, parsed.webhooks)
  }
}

const saveSettings = () => {
  localStorage.setItem('ohmyfinance_api_settings', JSON.stringify({
    apiKeys: apiKeys.value,
    webhooks: { ...webhookSettings }
  }))
}

const saveWebhookSettings = () => {
  saveSettings()
}

const createApiKey = () => {
  if (!newKeyName.value.trim()) return
  const id = Date.now().toString()
  const randomKey = 'omf_' + Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  apiKeys.value.push({
    id,
    name: newKeyName.value.trim(),
    maskedKey: randomKey.substring(0, 8) + '...' + randomKey.substring(randomKey.length - 4),
    createdAt: new Date().toISOString(),
    lastUsed: null
  })
  saveSettings()
  newKeyName.value = ''
  showCreateKeyModal.value = false
}

const deleteApiKey = (id: string) => {
  apiKeys.value = apiKeys.value.filter(k => k.id !== id)
  saveSettings()
}

const formatDate = (isoDate: string) => {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

onMounted(() => {
  loadSettings()
})
</script>
