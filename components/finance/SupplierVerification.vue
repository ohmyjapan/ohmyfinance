<template>
  <div class="mt-2 text-xs leading-relaxed" data-supplier-verification :data-registry-status="registration?.status || 'unverified'">
    <p :class="registration?.status === 'verified' ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'">{{ registration?.label || '公表情報は未確認' }}<span v-if="registration?.asOf"> · {{ registration.asOf }}時点</span></p>
    <template v-if="registration?.status === 'verified'">
      <p class="mt-1 break-words text-gray-700 dark:text-gray-300">{{ registration.legalName }}</p>
      <template v-if="details"><p class="mt-1 break-words text-gray-500 dark:text-gray-400">{{ registration.registeredAddress }}</p><p class="mt-1 text-gray-500 dark:text-gray-400">登録日 {{ registration.registeredFrom }} · 確認日時 {{ new Date(registration.checkedAt).toLocaleString('ja-JP') }}</p></template>
      <a :href="registration.sourceUrl" target="_blank" rel="noopener noreferrer" class="mt-1 inline-block py-1 text-primary-main underline underline-offset-2">国税庁の公表情報を開く ↗</a>
      <p v-if="details" class="mt-1 text-gray-500 dark:text-gray-400">確認日時点の登録情報です。購入内容・消費税率・この取引の書類は別途確認します。</p>
    </template>
  </div>
</template>
<script setup lang="ts">
defineProps<{ registration: any; details?: boolean }>()
</script>
