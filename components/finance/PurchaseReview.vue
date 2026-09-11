<template>
  <section class="card mb-6 p-4 sm:p-6" aria-label="購入内容の確認">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">購入内容を一緒に確認</h2><p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">確認済みの指示と過去の記録から先に判断し、まだ分からない点だけを確認します。</p></div>
      <span v-if="data?.review" class="badge-status bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300">{{ statusLabel }}</span>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="loading" class="mt-4 text-xs text-gray-500">過去の記録を確認しています…</p>
    <template v-if="data">
      <div v-if="data.study.answered?.length" class="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-white/5">
        <h3 class="text-xs font-semibold text-gray-800 dark:text-gray-200">OMFが判断できた項目</h3>
        <div v-for="answer in data.study.answered" :key="answer.field" class="mt-2 text-xs"><p class="font-medium text-gray-700 dark:text-gray-300">{{ answer.label }} · {{ answer.value }} <span v-if="['A','B'].includes(answer.grade)" class="ml-1 text-primary-main">{{ answer.grade==='A'?'確認済みの指示':'過去の傾向' }}</span></p><p class="mt-1 leading-relaxed text-gray-500 dark:text-gray-400">{{ answer.reason }}</p></div>
      </div>
      <p v-if="!data.study.needsQuestion" class="mt-4 text-sm text-green-700 dark:text-green-400">購入内容は判断できています。追加の質問はありません。</p>
      <div class="mt-4 space-y-3">
        <p v-for="signal in data.study.signals" :key="signal" class="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{{ signal }}</p>
        <details class="text-xs text-gray-500 dark:text-gray-400"><summary class="cursor-pointer py-1 text-primary-main">推定の根拠 · 過去 {{ data.study.historyCount }}件</summary><p class="mt-2">{{ data.study.historyScope }}</p><div v-for="(h, i) in data.study.hypotheses" :key="i" class="mt-3"><p class="font-medium text-gray-700 dark:text-gray-300">{{ h.label }}</p><p class="mt-1">{{ h.reason }}</p></div><p v-if="data.study.nearby.length" class="mt-3">前後2日以内の明細も参考にできます。同じ顧客の購入であることを示す根拠ではありません。</p><p v-for="n in data.study.nearby" :key="n.line" class="mt-1">{{ n.date }} · {{ n.description }} · ¥{{ Number(n.amount).toLocaleString('ja-JP') }}</p></details>
      </div>
      <div v-if="data.study.learning" class="mt-4 rounded-xl border border-gray-200 p-3 dark:border-white/10">
        <NuxtLink to="/learning" class="text-xs text-primary-main">学習ノートの元データを参照中 ↗</NuxtLink>
        <div v-for="rule in data.study.learning.rules" :key="rule.id" class="mt-3 text-xs">
          <NuxtLink :to="rule.kind === 'policy' ? {path:'/learning'} : {path:'/learning',query:{pattern:rule.id}}" class="font-medium text-green-700 dark:text-green-400">A · 確認済みの顧客・用途ルール</NuxtLink>
          <p class="mt-1 text-gray-700 dark:text-gray-300">{{ rule.decision.purpose==='company' ? '会社経費' : draft.references.customers.find((c:any)=>c._id===rule.decision.customerId)?.name || '顧客購入' }} · {{ rule.decision.effectiveFrom ? rule.decision.effectiveFrom+'以降' : '未登録の下書きに適用' }}</p>
          <p class="mt-1 whitespace-pre-wrap break-words text-gray-500 dark:text-gray-400">{{ rule.decision.note }}</p>
          <p class="mt-1 text-gray-500 dark:text-gray-400">元資料や保存済みの修正と相違がなければ、下書きに反映します。</p>
        </div>
      </div>
      <div v-if="!data.review && data.study.needsQuestion" class="mt-4 border-t border-gray-200 pt-4 dark:border-white/10">
        <p class="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{{ data.study.question }}</p>
        <button type="button" class="btn btn-secondary mt-4 text-sm" :disabled="busy || dirty || draft.locked || !data.connected" @click="ask">Slackで確認する</button>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ !data.connected ? 'Slackの送信先を設定すると、韓国語で質問できます。' : dirty ? '先に下書きの変更を保存してください。' : '回答から反映内容を提案します。Slackで確認するまで下書きは変更しません。' }}</p>
      </div>
      <div v-else-if="data.review" class="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-white/10">
        <p class="text-sm text-gray-700 dark:text-gray-300">{{ statusHelp }}</p>
        <p v-if="data.review.replies.some((r: any) => r.delivery === 'sending')" class="text-xs text-amber-700 dark:text-amber-400">返信の配信確認が完了していません。二重送信を避けるため、配信状況の確認が必要です。</p>
        <details v-if="data.review.replies.length" class="text-xs"><summary class="cursor-pointer py-1 text-primary-main">Slackの回答と確認履歴</summary><div v-for="reply in data.review.replies" :key="reply.ts" class="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-white/10"><p class="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{{ reply.text }}</p><p class="whitespace-pre-wrap break-words text-gray-500 dark:text-gray-400">{{ reply.response }}</p></div></details>
        <button v-if="['resolved','conflict'].includes(data.review.status)" type="button" class="btn btn-secondary text-sm" @click="$emit('reload')">最新の下書きを確認</button>
        <button type="button" class="ml-3 text-xs text-primary-main" :disabled="busy" @click="load">状態を更新</button>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { useUserStore } from '~/stores/user'
const props = defineProps<{ draft: any, dirty: boolean }>()
defineEmits<{ reload: [] }>()
const user = useUserStore(), data = ref<any>(null), loading = ref(true), busy = ref(false), error = ref('')
const endpoint = computed(() => `/api/finance-review/imports/${props.draft.importId}/drafts/${props.draft.line}`)
const labels: Record<string,string> = { queued: '送信待ち', sending: '送信状況を確認中', awaiting_reply: '回答待ち', proposed: '反映内容の確認待ち', resolved: '下書きに反映済み', deferred: '保留', conflict: '下書きの変更あり', delivery_unknown: '送信状況の確認が必要' }
const help: Record<string,string> = { queued: 'Ryzen 7のワーカーが質問を送信します。', sending: '送信を開始しました。中断時は二重送信を避け、配信状況を確認します。', awaiting_reply: 'Slackの質問スレッドに回答してください。', proposed: 'Slackで提案内容を確認してください。「확인」で今回のみ、「패턴으로 기억」で次回の判断にも参考にします。', resolved: '確認した回答を反映しました。勘定科目・税区分と帳簿への登録は、引き続きこの画面で確認してください。', deferred: '回答を保留しています。購入内容が分かったら、この画面で入力できます。', conflict: '質問後に下書きが変更されたため、回答による上書きを止めました。回答を参照して最新の下書きを確認してください。', delivery_unknown: '配信結果を確認してください。自動で再送しません。' }
const statusLabel = computed(() => labels[data.value?.review?.status] || '')
const statusHelp = computed(() => help[data.value?.review?.status] || '')
async function load() { busy.value = true; error.value = ''; try { data.value = await $fetch(endpoint.value, { headers: user.authHeader }) } catch (e: any) { error.value = e.data?.data?.message || '確認状況を取得できませんでした。' } finally { busy.value = false; loading.value = false } }
async function ask() { busy.value = true; error.value = ''; try { await $fetch(endpoint.value, { method: 'POST', headers: user.authHeader, body: { revision: props.draft.revision, key: props.draft.key, sourceHash: props.draft.sourceHash } }); await load() } catch (e: any) { error.value = e.data?.data?.message || '質問を送信待ちにできませんでした。'; busy.value = false } }
onMounted(load)
watch(() => props.draft.revision, load)
</script>
