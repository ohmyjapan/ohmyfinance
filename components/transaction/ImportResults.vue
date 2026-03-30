<template>
  <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm">
    <div class="p-6">
      <!-- Success/Error Header -->
      <div class="mb-8 text-center">
        <div v-if="result?.success" class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-green-500/10 flex items-center justify-center">
          <CheckCircle class="h-8 w-8 text-green-500" />
        </div>
        <div v-else class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <XCircle class="h-8 w-8 text-red-500" />
        </div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {{ result?.success ? t('importResults.successTitle') : t('importResults.errorTitle') }}
        </h2>
        <p v-if="result?.error" class="text-sm text-red-500">{{ result.error }}</p>
      </div>

      <!-- Stats Grid -->
      <div v-if="result?.results" class="max-w-2xl mx-auto mb-8">
        <div class="grid grid-cols-3 gap-4">
          <div class="rounded-xl border border-gray-200 dark:border-white/10 p-4 text-center">
            <p class="text-2xl font-bold font-mono text-green-600 dark:text-green-400">{{ result.results.imported }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('importResults.imported') }}</p>
          </div>
          <div class="rounded-xl border border-gray-200 dark:border-white/10 p-4 text-center">
            <p class="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">{{ result.results.skipped }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('importResults.skipped') }}</p>
          </div>
          <div class="rounded-xl border border-gray-200 dark:border-white/10 p-4 text-center">
            <p class="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{{ result.results.errors?.length || 0 }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('importResults.errors') }}</p>
          </div>
        </div>
      </div>

      <!-- Batch ID -->
      <div v-if="result?.batchId" class="max-w-2xl mx-auto mb-8">
        <div class="flex items-center justify-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('importResults.batchId') }}:</span>
          <code class="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{{ result.batchId }}</code>
          <button @click="copyBatchId" class="p-1 text-gray-400 hover:text-primary-main transition-colors">
            <Copy class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- Errors (expandable) -->
      <div v-if="result?.results?.errors?.length > 0" class="max-w-2xl mx-auto mb-8">
        <button @click="showErrors = !showErrors" class="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400 mb-3">
          <ChevronDown class="h-4 w-4 transition-transform" :class="{ 'rotate-180': showErrors }" />
          {{ t('importResults.showErrors', { count: result.results.errors.length }) }}
        </button>
        <div v-if="showErrors" class="space-y-2 max-h-60 overflow-y-auto">
          <div v-for="(err, i) in result.results.errors" :key="i" class="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm">
            <p class="text-red-700 dark:text-red-400">{{ err.error }}</p>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-center gap-4 max-w-2xl mx-auto">
        <NuxtLink
          v-if="result?.batchId"
          :to="`/transactions?tag=batch:${result.batchId}`"
          class="inline-flex items-center px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300"
        >
          <ExternalLink class="mr-2 h-4 w-4" />
          {{ t('importResults.viewTransactions') }}
        </NuxtLink>
        <button
          @click="$emit('importMore')"
          class="inline-flex items-center px-5 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200"
        >
          <Upload class="mr-2 h-4 w-4" />
          {{ t('importResults.importMore') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CheckCircle, XCircle, Copy, ChevronDown, ExternalLink, Upload } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  result: { type: Object, default: null }
})

defineEmits(['importMore'])

const showErrors = ref(false)

const copyBatchId = async () => {
  if (props.result?.batchId) {
    try {
      await navigator.clipboard.writeText(props.result.batchId)
    } catch {
      // Fallback for non-HTTPS contexts
      const textArea = document.createElement('textarea')
      textArea.value = props.result.batchId
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }
}
</script>
