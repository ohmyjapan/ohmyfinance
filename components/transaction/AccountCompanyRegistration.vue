<!-- components/transaction/AccountCompanyRegistration.vue -->
<!-- Makes the selected 勘定科目/補助科目 available to the current company's Navi. It only registers availability: the transaction is not
     saved and the shared account does not become company-owned. A response that arrives after the user, company or account changed
     is dropped. -->
<template>
  <div v-if="accountId" class="mt-2 text-xs space-y-1" data-account-registration :data-account-registration-kind="kind">
    <p v-if="!company" class="text-gray-500 dark:text-gray-400" data-account-registration-status>
      {{ createdNote || words.noCompany }}
    </p>
    <div v-else class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-account-registration-button
        :disabled="busy || registered"
        class="inline-flex items-center gap-1 max-w-full px-2.5 py-1 rounded-lg border border-primary-main text-primary-main dark:text-primary-light hover:bg-primary-light dark:hover:bg-primary-dark/30 disabled:opacity-60 touch-manipulation text-left"
        @click="registerAccount"
      >
        <Loader v-if="busy" class="w-3 h-3 shrink-0 animate-spin" />
        <CheckCircle v-else-if="registered" class="w-3 h-3 shrink-0" />
        <Plus v-else class="w-3 h-3 shrink-0" />
        <span>{{ registered ? words.registered : words.action }}</span>
      </button>
      <span class="min-w-0 break-all text-gray-500 dark:text-gray-400" data-account-registration-company>{{ company.name }}</span>
    </div>
    <p
      v-if="company && message"
      role="status"
      data-account-registration-status
      :class="failed ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'"
    >
      {{ message }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Plus, CheckCircle, Loader } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const props = defineProps<{
  accountId?: string
  accountName?: string
  kind: 'account' | 'subAccount'
  // The native create result of an account made in this form: its id and the company it was registered for (null = none).
  created?: { accountId: string, companyId: string | null } | null
}>()

const { locale } = useI18n()
const userStore = useUserStore()

const company = computed(() => userStore.currentOrganization?.id ? { id: String(userStore.currentOrganization.id), name: String(userStore.currentOrganization.name || '') } : null)
const key = computed(() => [userStore.user?.id || '', company.value?.id || '', props.accountId || ''].join('|'))
const name = computed(() => props.accountName || '')

const ko = computed(() => String(locale.value || '').startsWith('ko'))
const words = computed(() => ko.value ? {
  action: '이 회사의 Navi에서 쓸 수 있게 등록',
  registered: 'Navi에 등록됨',
  noCompany: '회사를 선택하면 이 과목을 이 회사의 Navi에서 쓰도록 등록할 수 있습니다.',
  saved: (n: string, c: string) => `「${n}」을(를) ${c}의 Navi 선택지에 등록했습니다. 거래는 아직 저장되지 않았습니다.`,
  already: (n: string, c: string) => `「${n}」은(는) 이미 ${c}의 Navi에 등록되어 있습니다.`,
  created: (n: string, c: string) => `새 과목 「${n}」이(가) ${c}의 Navi에 등록되었습니다.`,
  createdNoCompany: '회사가 선택되지 않아 이 과목은 어느 회사의 Navi에도 등록되지 않았습니다.',
  notFound: '이 과목을 찾을 수 없거나 사용 중지되었습니다.',
  denied: '이 회사의 접근 권한을 확인할 수 없습니다.',
  failed: '등록하지 못했습니다. 다시 시도해 주세요.'
} : {
  action: 'この会社のNaviで使えるようにする',
  registered: 'Naviに登録済み',
  noCompany: '会社を選択すると、この科目をこの会社のNaviで使えるよう登録できます。',
  saved: (n: string, c: string) => `「${n}」を${c}のNaviの選択肢に登録しました。取引はまだ保存されていません。`,
  already: (n: string, c: string) => `「${n}」は${c}のNaviに登録済みです。`,
  created: (n: string, c: string) => `新しい科目「${n}」は${c}のNaviに登録されました。`,
  createdNoCompany: '会社が選択されていないため、この科目はどの会社のNaviにも登録されていません。',
  notFound: 'この科目が見つからないか、無効になっています。',
  denied: 'この会社へのアクセス権を確認できませんでした。',
  failed: '登録できませんでした。もう一度お試しください。'
})

const busy = ref(false)
const registered = ref(false)
const failed = ref(false)
const message = ref('')
let ticket = 0

const createdHere = computed(() => !!props.created && props.created.accountId === props.accountId)
const createdNote = computed(() => createdHere.value && !props.created?.companyId ? words.value.createdNoCompany : '')

// Any change of user, company or account starts over and invalidates a pending request.
watch([key, () => props.created], () => {
  ticket++
  busy.value = false
  failed.value = false
  registered.value = createdHere.value && !!company.value && props.created?.companyId === company.value.id
  message.value = registered.value ? words.value.created(name.value, company.value!.name) : ''
}, { immediate: true })

const registerAccount = async () => {
  if (!props.accountId || !company.value || busy.value) return
  const mine = ++ticket, sent = key.value, companyName = company.value.name, accountName = name.value
  busy.value = true
  failed.value = false
  message.value = ''
  try {
    const result = await $fetch<any>(`/api/account-categories/${encodeURIComponent(props.accountId)}/registration`, { method: 'POST', headers: userStore.authHeader, body: {} })
    if (mine !== ticket || sent !== key.value) return
    registered.value = true
    message.value = result?.state === 'already_registered' ? words.value.already(accountName, companyName) : words.value.saved(accountName, companyName)
  } catch (e: any) {
    if (mine !== ticket || sent !== key.value) return
    const status = e?.statusCode || e?.response?.status
    failed.value = true
    message.value = status === 404 ? words.value.notFound : status === 403 || status === 401 ? words.value.denied : words.value.failed
  } finally {
    if (mine === ticket) busy.value = false
  }
}
</script>
