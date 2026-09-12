<template>
  <details class="supplier-memory mt-4 rounded-xl border border-gray-200 text-sm dark:border-white/10" data-supplier-memory @toggle="opened">
    <summary class="cursor-pointer px-4 py-3 font-medium text-primary-main">仕入れ先の確認・記憶</summary>
    <div class="border-t border-gray-200 p-4 dark:border-white/10 sm:p-5">
      <p v-if="loading" role="status" class="text-xs text-gray-500">仕入れ先を読み込んでいます…</p>
      <p v-if="error" role="alert" class="mb-3 text-xs text-red-600 dark:text-red-400">{{ error }} <button type="button" class="underline" :disabled="busy || loading" @click="load">再読込</button></p>
      <template v-if="data">
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ data.accountName }} · {{ data.descriptor }}</p>
        <p class="mt-2 text-xs" :class="['stale','conflict'].includes(data.match.status) ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'" data-supplier-match>{{ data.match.reason }}</p>
        <fieldset :disabled="busy || disabled" class="mt-4 min-w-0">
          <div class="grid min-w-0 gap-5 md:grid-cols-2">
            <div class="min-w-0">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">運営会社・仕入れ先
                <select v-model="supplierId" data-supplier-choice class="supplier-control mt-2" @change="confirmed = false"><option value="">仕入れ先を選択</option><option v-for="supplier in data.suppliers" :key="supplier._id" :value="supplier._id">{{ supplier.name }}{{ supplier.companyName && supplier.companyName !== supplier.name ? ' · ' + supplier.companyName : '' }}</option></select>
              </label>
              <p v-if="!data.suppliers.length" class="mt-2 text-xs text-gray-500">下書きの「仕入れ先」から台帳の項目を追加できます。</p>
              <div v-if="selected" class="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-white/5">
                <p class="break-all text-sm font-medium text-gray-800 dark:text-gray-200">{{ selected.invoiceNumber || 'インボイス登録番号 未取得' }}</p>
                <SupplierVerification :registration="selected.registration" details />
              </div>
            </div>
            <div class="min-w-0 space-y-3">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">対応を確認した根拠<input v-model="reason" data-supplier-reason class="supplier-control mt-2" maxlength="1000" placeholder="例：領収書の発行会社と一致" @input="confirmed = false"></label>
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">根拠のページ（任意）<input v-model="sourceUrl" data-supplier-source type="url" class="supplier-control mt-2" maxlength="2000" placeholder="https://…" @input="confirmed = false"></label>
              <label class="flex items-start gap-2 text-xs leading-relaxed text-gray-700 dark:text-gray-300"><input v-model="confirmed" data-supplier-confirm type="checkbox" class="mt-0.5 rounded border-gray-300 text-primary-main focus:ring-primary-main">この利用先の運営会社・仕入れ先との対応を確認しました。</label>
            </div>
          </div>
          <p class="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">この口座の同じ利用先表記に、仕入れ先と登録番号を提案します。顧客・用途・税率は別の根拠で判断します。</p>
          <p v-if="data.saved" class="mt-2 text-xs text-amber-700 dark:text-amber-400">この行には保存済みの下書きがあります。記憶を更新しても保存済みの値は変わりません。新しい候補は下書きで選べます。</p>
          <p v-if="disabled" class="mt-2 text-xs text-amber-700 dark:text-amber-400">編集中の内容を保存してから記憶を更新してください。</p>
          <div class="mt-4 flex flex-wrap gap-3"><button type="button" data-save-supplier class="btn btn-primary text-xs disabled:opacity-50" :disabled="!selected || !reason.trim() || !confirmed" @click="save(true)">この口座で記憶する</button><button v-if="data.link?.enabled" type="button" data-disable-supplier class="btn btn-secondary text-xs" @click="save(false)">記憶の適用を停止</button></div>
        </fieldset>
        <p v-if="data.link?.confirmedAt" class="mt-3 text-xs text-gray-500 dark:text-gray-400">対応の確認日時 {{ new Date(data.link.confirmedAt).toLocaleString('ja-JP') }}</p>
        <p v-if="message" role="status" class="mt-3 text-xs text-green-700 dark:text-green-400">{{ message }}</p>
      </template>
    </div>
  </details>
</template>
<script setup lang="ts">
import { useUserStore } from '~/stores/user'
import SupplierVerification from './SupplierVerification.vue'
const props = defineProps<{ importId: string; line: number; disabled?: boolean }>()
const emit = defineEmits<{ changed: [] }>(), user = useUserStore()
const data = ref<any>(null), loading = ref(false), busy = ref(false), error = ref(''), message = ref('')
const supplierId = ref(''), reason = ref(''), sourceUrl = ref(''), confirmed = ref(false)
const selected = computed(() => data.value?.suppliers.find((s: any) => s._id === supplierId.value))
const endpoint = computed(() => '/api/finance/imports/' + props.importId + '/merchant-links/' + props.line)
function receive(value: any) { data.value = value; supplierId.value = value.link?.supplierId || value.saved?.supplierId || value.match.supplierId; reason.value = value.link?.reason || ''; sourceUrl.value = value.link?.sourceUrl || ''; confirmed.value = false }
const explain = (e: any) => e.data?.data?.message || e.data?.message || e.data?.statusMessage || e.message || '読み込めませんでした。再試行してください。'
async function load() { if (loading.value || busy.value) return; loading.value = true; error.value = ''; try { receive(await $fetch(endpoint.value, { headers: user.authHeader })) } catch (e: any) { error.value = explain(e) } finally { loading.value = false } }
function opened(event: Event) { if ((event.target as HTMLDetailsElement).open && !data.value) load() }
async function save(enabled: boolean) {
  if (busy.value || props.disabled) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await $fetch(endpoint.value, { method: 'PUT', headers: user.authHeader, body: { sourceHash: data.value.sourceHash, key: data.value.key, revision: data.value.revision, enabled, confirmed: confirmed.value, supplierId: supplierId.value, supplierKey: selected.value?.identityKey, reason: reason.value, sourceUrl: sourceUrl.value } })
    receive(result); message.value = enabled ? '利用先と仕入れ先の対応を記憶しました。' : '記憶の適用を停止しました。'; emit('changed')
  } catch (e: any) { error.value = explain(e) } finally { busy.value = false }
}
</script>
<style scoped>
.supplier-control { @apply block w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100 disabled:opacity-60; }
</style>
