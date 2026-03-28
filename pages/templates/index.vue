<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">{{ t('templates.title') }}</h1>
        <p class="text-gray-600">{{ t('templates.description') }}</p>
      </div>
    </header>

    <div v-if="isLoading" class="text-center py-12 text-gray-500">{{ t('common.loading') }}</div>

    <div v-else-if="templates.length === 0" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-12 text-center">
      <FileSpreadsheet class="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 mb-2">{{ t('templates.noTemplates') }}</h3>
      <p class="text-gray-500 mb-4">{{ t('templates.noTemplatesDescription') }}</p>
      <NuxtLink to="/transactions/import" class="inline-flex items-center px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation">
        <Upload class="h-4 w-4 mr-2" />
        {{ t('templates.importTransactions') }}
      </NuxtLink>
    </div>

    <div v-else class="grid gap-4">
      <div v-for="template in templates" :key="template.id" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
        <div class="flex justify-between items-start">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-medium text-gray-900">{{ template.name }}</h3>
              <span v-if="template.isDefault" class="px-2 py-0.5 bg-primary-main/20 text-primary-dark text-xs rounded-full">{{ t('templates.default') }}</span>
            </div>
            <p v-if="template.description" class="text-sm text-gray-500 mt-1">{{ template.description }}</p>
            <div class="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span class="capitalize">{{ formatSourceType(template.sourceType) }}</span>
              <span>{{ t('templates.fieldsMapped', { count: template.mappings?.length || 0 }) }}</span>
              <span>{{ t('templates.created') }} {{ formatDate(template.createdAt) }}</span>
            </div>
          </div>
          <div class="flex space-x-2">
            <button @click="viewTemplate(template)" class="p-2 text-gray-500 hover:text-gray-700" :title="t('templates.viewDetails')">
              <Eye class="h-4 w-4" />
            </button>
            <button @click="setDefault(template)" v-if="!template.isDefault" class="p-2 text-gray-500 hover:text-primary-main" :title="t('templates.setAsDefault')">
              <Star class="h-4 w-4" />
            </button>
            <button @click="deleteTemplate(template)" class="p-2 text-gray-500 hover:text-red-600" :title="t('common.delete')">
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Mappings Preview -->
        <div v-if="expandedTemplate === template.id" class="mt-4 pt-4 border-t border-gray-200">
          <h4 class="text-sm font-medium text-gray-700 mb-2">{{ t('templates.fieldMappings') }}</h4>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div v-for="mapping in template.mappings" :key="mapping.sourceField" class="bg-gray-50 rounded px-3 py-2 text-sm">
              <div class="text-gray-500">{{ mapping.sourceField }}</div>
              <div class="font-medium text-gray-700">→ {{ mapping.targetField }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { FileSpreadsheet, Upload, Eye, Star, Trash2 } from 'lucide-vue-next'

const { t, locale } = useI18n()
const isLoading = ref(false)
const templates = ref<any[]>([])
const expandedTemplate = ref<string | null>(null)

const loadTemplates = async () => {
  isLoading.value = true
  try {
    templates.value = await $fetch('/api/templates')
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
    // Unset current default
    const currentDefault = templates.value.find(t => t.isDefault)
    if (currentDefault) {
      await $fetch(`/api/templates/${currentDefault.id}`, {
        method: 'PUT',
        body: { isDefault: false }
      })
    }

    // Set new default
    await $fetch(`/api/templates/${template.id}`, {
      method: 'PUT',
      body: { isDefault: true }
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
    await $fetch(`/api/templates/${template.id}`, { method: 'DELETE' })
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
