<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('templates.title') }}</h1>
          <p class="mt-1 text-gray-500 dark:text-gray-400">{{ t('templates.description') }}</p>
        </div>
        <NuxtLink
          to="/transactions/import"
          class="inline-flex items-center px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
        >
          <Upload class="mr-2 h-4 w-4" />
          {{ t('templates.importTransactions') }}
        </NuxtLink>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="p-12 text-center">
      <div class="flex flex-col items-center gap-3">
        <Loader2 class="w-6 h-6 animate-spin text-primary-main" />
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="templates.length === 0" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-12 text-center">
      <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
        <FileSpreadsheet class="w-8 h-8 text-gray-400 dark:text-gray-500" />
      </div>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('templates.noTemplates') }}</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">{{ t('templates.noTemplatesDescription') }}</p>
      <NuxtLink
        to="/transactions/import"
        class="inline-flex items-center px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
      >
        <Upload class="h-4 w-4 mr-2" />
        {{ t('templates.importTransactions') }}
      </NuxtLink>
    </div>

    <!-- Template Cards Grid -->
    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="template in templates"
        :key="template.id"
        class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group"
      >
        <!-- Card Header -->
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
              <FileSpreadsheet class="w-6 h-6 text-primary-main dark:text-primary-light" />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white truncate">{{ template.name }}</h3>
                <span v-if="template.isDefault" class="bg-primary-main/10 dark:bg-primary-main/20 text-primary-main dark:text-primary-light rounded-lg px-2 py-0.5 text-xs font-medium flex-shrink-0">
                  {{ t('templates.default') }}
                </span>
              </div>
              <p v-if="template.description" class="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">{{ template.description }}</p>
            </div>
          </div>
        </div>

        <!-- Card Meta -->
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <span class="bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 rounded-lg px-2.5 py-1 text-xs font-medium capitalize">
            {{ formatSourceType(template.sourceType) }}
          </span>
          <span class="bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg px-2.5 py-1 text-xs font-medium">
            {{ t('templates.fieldsMapped', { count: template.mappings?.length || 0 }) }}
          </span>
        </div>

        <!-- Card Footer -->
        <div class="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-white/10">
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('templates.created') }} {{ formatDate(template.createdAt) }}
          </span>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              @click="viewTemplate(template)"
              class="p-2 rounded-lg text-gray-400 hover:text-primary-main hover:bg-primary-main/10 transition-colors touch-manipulation"
              :title="t('templates.viewDetails')"
            >
              <Eye class="h-4 w-4" />
            </button>
            <button
              v-if="!template.isDefault"
              @click="setDefault(template)"
              class="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-500/10 transition-colors touch-manipulation"
              :title="t('templates.setAsDefault')"
            >
              <Star class="h-4 w-4" />
            </button>
            <button
              @click="deleteTemplate(template)"
              class="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-colors touch-manipulation"
              :title="t('common.delete')"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Expanded Mappings -->
        <div v-if="expandedTemplate === template.id" class="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
          <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{{ t('templates.fieldMappings') }}</h4>
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="mapping in template.mappings"
              :key="mapping.sourceField"
              class="bg-gray-50 dark:bg-white/[0.03] rounded-xl px-3 py-2 text-sm flex items-center gap-2"
            >
              <span class="text-gray-500 dark:text-gray-400 font-mono text-xs">{{ mapping.sourceField }}</span>
              <ArrowRight class="h-3 w-3 text-gray-400 flex-shrink-0" />
              <span class="font-medium text-gray-700 dark:text-gray-300 text-xs">{{ mapping.targetField }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { FileSpreadsheet, Upload, Eye, Star, Trash2, ArrowRight, Loader2 } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
const isLoading = ref(false)
const templates = ref<any[]>([])
const expandedTemplate = ref<string | null>(null)

const loadTemplates = async () => {
  isLoading.value = true
  try {
    templates.value = await $fetch('/api/templates', { headers: userStore.authHeader })
  } catch (error) {
    console.error('Failed to load templates:', error)
  } finally {
    isLoading.value = false
  }
}

const viewTemplate = (template: any) => {
  expandedTemplate.value = expandedTemplate.value === template.id ? null : template.id
}

const setDefault = async (template: any) => {
  try {
    const currentDefault = templates.value.find(t => t.isDefault)
    if (currentDefault) {
      await $fetch(`/api/templates/${currentDefault.id}`, {
        method: 'PUT',
        body: { isDefault: false },
        headers: userStore.authHeader
      })
    }

    await $fetch(`/api/templates/${template.id}`, {
      method: 'PUT',
      body: { isDefault: true },
      headers: userStore.authHeader
    })

    await loadTemplates()
  } catch (error) {
    console.error('Failed to set default:', error)
    alert('Failed to set default template')
  }
}

const deleteTemplate = async (template: any) => {
  if (!confirm(`Delete template "${template.name}"?`)) return

  try {
    await $fetch(`/api/templates/${template.id}`, { method: 'DELETE', headers: userStore.authHeader })
    await loadTemplates()
  } catch (error) {
    console.error('Failed to delete:', error)
    alert('Failed to delete template')
  }
}

const formatSourceType = (type: string) => {
  const key = `import.sources.${type}`
  return t(key) || type
}

const formatDate = (dateStr: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateStr).toLocaleDateString(dateLocale)
}

onMounted(() => loadTemplates())
</script>
