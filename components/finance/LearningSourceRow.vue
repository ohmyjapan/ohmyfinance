<template>
  <div class="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-white/10"><span class="text-xs font-medium text-gray-600 dark:text-gray-300">元のセル · {{ source.row.sheet }} {{ source.row.row }}行</span><a :href="link" target="_blank" rel="noopener noreferrer" class="text-xs text-primary-main">Google Sheetsで開く ↗</a></div>
    <dl class="divide-y divide-gray-200 dark:divide-white/10"><div v-for="cell in source.row.cells" :key="cell.address" class="grid grid-cols-[90px_minmax(0,1fr)] gap-3 px-3 py-2 text-xs sm:grid-cols-[120px_minmax(0,1fr)]"><dt class="break-words text-gray-500 dark:text-gray-400">{{ cell.address }}<span class="mt-1 block">{{ cell.header || '見出しなし' }}</span></dt><dd class="min-w-0 whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{{ cell.value ?? '値なし' }}<span v-if="cell.formatted && String(cell.value)!==cell.formatted" class="mt-1 block text-gray-500 dark:text-gray-400">シート表示：{{ cell.formatted }}</span><code v-if="cell.formula" class="mt-1 block break-all text-gray-500 dark:text-gray-400">={{ cell.formula }}</code></dd></div></dl>
    <p class="border-t border-gray-200 px-3 py-2 text-xs leading-relaxed text-gray-500 dark:border-white/10 dark:text-gray-400">金額・番号は元の値を保存しています。見出しのない列や数式の意味は自動で決めません。</p>
  </div>
</template>
<script setup lang="ts">
const props=defineProps<{source:any}>()
const link=computed(()=>props.source.dataset.sourceUrl+'#range='+encodeURIComponent("'"+props.source.row.sheet.replaceAll("'","''")+"'!A"+props.source.row.row+':AD'+props.source.row.row))
</script>
