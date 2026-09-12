<template>
  <div class="space-y-3">
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <div v-for="doc in documents" :key="doc.id || doc.filename" class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
      <div class="min-w-0 flex-1"><p class="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{{ doc.name || doc.originalName }}</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ labels[doc.kind] || '添付書類' }} · {{ Math.ceil(doc.size / 1024) }} KB</p></div>
      <button type="button" class="btn btn-secondary text-xs" :disabled="busy" @click="download(doc)">ダウンロード</button>
      <button v-if="removable" type="button" class="px-2 py-2 text-xs text-red-600 dark:text-red-400" :disabled="busy" @click="$emit('remove', doc)">削除</button>
      <DocumentReader v-if="readable" class="w-full" :document="doc" :values="values || {}" :disabled="disabled" @select="$emit('select',$event)" @reading="$emit('reading',$event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import DocumentReader from './DocumentReader.vue'
import { useUserStore } from '~/stores/user'
defineProps<{ documents: any[]; removable?: boolean; readable?: boolean; disabled?: boolean; values?: any }>()
defineEmits<{ remove: [document: any]; select:[selection:any]; reading:[document:any] }>()
const user = useUserStore(), error = ref(''), busy = ref(false)
const labels: Record<string, string> = { receipt: '領収書', invoice: '請求書', shipping: '発送・顧客照合資料', other: 'その他' }
async function download(doc: any) {
  busy.value = true; error.value = ''
  try {
    const url = doc.url || doc.path
    if (!/^\/api\/finance\/documents\/[a-f\d]{24}\/file$/.test(url)) throw Error('書類の保存先を確認できません。')
    const blob = await $fetch<Blob>(url, { headers: user.authHeader, responseType: 'blob' })
    const objectUrl = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = objectUrl; link.download = doc.name || doc.originalName || 'document'; link.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (e: any) { error.value = e.data?.data?.message || '書類をダウンロードできませんでした。' } finally { busy.value = false }
}
</script>
