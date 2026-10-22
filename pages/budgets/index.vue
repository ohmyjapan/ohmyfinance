<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('budgets.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('budgets.description') }}</p>
      </div>
      <button
          @click="openModal()"
          class="mt-4 md:mt-0 inline-flex items-center px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation"
      >
        <Plus class="h-4 w-4 mr-2" />
        {{ t('budgets.newBudget') }}
      </button>
    </header>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.totalBudgeted') }}</div>
        <div v-for="group in stats" :key="'b' + group.currency" class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(group.budget, group.currency) }}</div>
        <div v-if="!stats.length" class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">-</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.totalSpent') }}</div>
        <div v-for="group in stats" :key="'s' + group.currency" class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(group.spent, group.currency) }}</div>
        <div v-if="!stats.length" class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">-</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.remaining') }}</div>
        <div v-for="group in stats" :key="'r' + group.currency" class="text-2xl font-bold font-mono" :class="group.budget - group.spent >= 0 ? 'text-green-600' : 'text-red-600'">
          {{ formatCurrency(group.budget - group.spent, group.currency) }}
        </div>
        <div v-if="!stats.length" class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">-</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.overBudget') }}</div>
        <div class="text-2xl font-bold font-mono text-red-600">{{ overBudgetCount }}</div>
      </div>
    </div>

    <!-- Budgets List -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
      <div v-if="isLoading" class="p-8 text-center text-gray-500">{{ t('common.loading') }}</div>
      <div v-else-if="budgets.length === 0" class="p-8 text-center text-gray-500">
        {{ t('budgets.noBudgets') }}
      </div>
      <div v-else class="divide-y divide-gray-200 dark:divide-white/10">
        <div v-for="budget in budgets" :key="budget.id" class="p-4 hover:bg-gray-50 dark:hover:bg-white/[0.07]">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center space-x-3">
              <div class="flex-shrink-0">
                <div
                    class="w-10 h-10 rounded-full flex items-center justify-center"
                    :class="getBudgetColor(budget)"
                >
                  <Wallet class="h-5 w-5 text-white" />
                </div>
              </div>
              <div>
                <h3 class="font-medium text-gray-900 dark:text-gray-100">{{ budget.name }}</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{ budget.category || t('budgets.allCategories') }} · {{ budget.period }}
                  <span v-if="budget.spending?.range"> · {{ budget.spending.range.start }} – {{ budget.spending.range.end }} ({{ budget.spending.timezone }})</span>
                </p>
                <NaviConsultButton class="mt-1.5" kind="budget" :record-id="String(budget.id)" :label="budgetLabel(budget)" :disabled="!navi.available.value" @consult="navi.consult({ id: String(budget.id), label: budgetLabel(budget) })" />
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <div class="text-right">
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ formatCurrency(budget.spent, budget.currency) }} / {{ formatCurrency(budget.amount, budget.currency) }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ budget.transactionCount }} {{ t('nav.transactions') }}
                </div>
              </div>
              <div class="flex space-x-2">
                <button @click="openModal(budget)" class="p-1 text-gray-400 hover:text-gray-600">
                  <Edit class="h-4 w-4" />
                </button>
                <button @click="deleteBudget(budget.id)" class="p-1 text-gray-400 hover:text-red-600">
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="mt-3">
            <div class="flex justify-between text-xs mb-1">
              <span :class="budget.isOverBudget ? 'text-red-600' : budget.isNearLimit ? 'text-yellow-600' : 'text-gray-500'">
                {{ budget.percentage }}% {{ t('budgets.used') }}
              </span>
              <span class="text-gray-500 dark:text-gray-400">
                {{ formatCurrency(budget.remaining, budget.currency) }} {{ t('budgets.remaining') }}
              </span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-slate-600 rounded-full h-2">
              <div
                  class="h-2 rounded-full transition-all"
                  :class="getProgressColor(budget)"
                  :style="{ width: Math.min(budget.percentage, 100) + '%' }"
              ></div>
            </div>
          </div>

          <!-- Alert -->
          <div v-if="budget.isOverBudget" class="mt-2 flex items-center text-red-600 text-sm">
            <AlertTriangle class="h-4 w-4 mr-1" />
            {{ t('budgets.overBudgetBy', { amount: formatCurrency(Math.abs(budget.remaining), budget.currency) }) }}
          </div>
          <div v-else-if="budget.isNearLimit" class="mt-2 flex items-center text-yellow-600 text-sm">
            <AlertTriangle class="h-4 w-4 mr-1" />
            {{ t('budgets.approachingLimit') }}
          </div>

          <!-- Evidence limits: what the completed-expense total does not include -->
          <ul v-if="evidenceNotes(budget).length" class="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
            <li v-for="line in evidenceNotes(budget)" :key="line">{{ line }}</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            {{ editingBudget ? t('budgets.editBudget') : t('budgets.newBudget') }}
          </h3>

          <form @submit.prevent="saveBudget" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.name') }}</label>
              <input
                  v-model="form.name"
                  type="text"
                  required
                  class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
                  :placeholder="t('budgets.namePlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.category') }} ({{ t('common.optional') }})</label>
              <input
                  v-model="form.category"
                  type="text"
                  class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
                  :placeholder="t('budgets.categoryPlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('budgets.amount') }}</label>
              <input
                  v-model.number="form.amount"
                  type="number"
                  required
                  min="0"
                  class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactions.currency') }}</label>
              <select
                  v-model="form.currency"
                  required
                  class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
              >
                <option v-for="code in currencyChoices" :key="code" :value="code">{{ code }}</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('budgets.period') }}</label>
              <select
                  v-model="form.period"
                  class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
              >
                <option value="monthly">{{ t('budgets.periods.monthly') }}</option>
                <option value="quarterly">{{ t('budgets.periods.quarterly') }}</option>
                <option value="yearly">{{ t('budgets.periods.yearly') }}</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('budgets.alertThreshold') }} (%)</label>
              <input
                  v-model.number="form.alertThreshold"
                  type="number"
                  min="0"
                  max="100"
                  class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
              />
            </div>

            <div class="flex items-center">
              <input
                  v-model="form.isActive"
                  type="checkbox"
                  id="isActive"
                  class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 rounded"
              />
              <label for="isActive" class="ml-2 text-sm text-gray-700 dark:text-gray-300">{{ t('budgets.active') }}</label>
            </div>

            <div class="flex justify-end space-x-3 pt-4">
              <button
                  type="button"
                  @click="showModal = false"
                  class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                  type="submit"
                  class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark"
              >
                {{ editingBudget ? t('common.edit') : t('common.create') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Wallet, Edit, Trash2, AlertTriangle } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { tokenClaims } from '~/utils/auth-session'
import NaviConsultButton from '~/components/finance/NaviConsultButton.vue'
import { useNaviRecordSelection } from '~/composables/useNaviRecordSelection'

const { t, locale } = useI18n()
const userStore = useUserStore()
const assistant = useAssistantStore()
// Consulting Navi about one saved budget (pointer only; the editor and its values are never published).
const navi = useNaviRecordSelection('budgets')
const budgetLabel = (budget: any) => String(budget.name || '')

const isLoading = ref(false)
const showModal = ref(false)
const budgets = ref<any[]>([])
const editingBudget = ref<any>(null)

const form = reactive({
  name: '',
  category: '',
  amount: 0,
  currency: 'JPY',
  period: 'monthly',
  alertThreshold: 80,
  isActive: true
})

const baseCurrencies = ['JPY', 'USD', 'EUR', 'KRW', 'CNY', 'GBP']
const currencyChoices = computed(() => !form.currency || baseCurrencies.includes(form.currency) ? baseCurrencies : [form.currency, ...baseCurrencies])

// Totals are kept per saved budget currency; different currencies are never added together.
const stats = computed(() => {
  const groups = new Map<string, { currency: string, budget: number, spent: number }>()
  for (const b of budgets.value) {
    const currency = b.currency || ''
    const group = groups.get(currency) || { currency, budget: 0, spent: 0 }
    group.budget += Number(b.amount) || 0
    group.spent += Number(b.spent) || 0
    groups.set(currency, group)
  }
  return [...groups.values()]
})
const overBudgetCount = computed(() => budgets.value.filter(b => b.isOverBudget).length)

const notesText: Record<string, Record<string, string>> = {
  ja: {
    basis: '完了済みの支出のみを集計しています（予定・未確定は含みません）。',
    pending: '予定（未払い）{count}件 {amount} は含まれていません。',
    other: '別通貨の支出 {list} は含まれていません。',
    unknown: '通貨が不明な支出 {count}件は含まれていません（0円ではありません）。',
    unclassified: 'カテゴリ未設定の支出 {count}件は含まれていません。',
    negative: '返金・マイナス {count}件 {amount} を差し引いています。',
    outside: 'この期間は予算の開始日・終了日の範囲外です。',
    category: 'カテゴリは取引の保存済みカテゴリ文字列との完全一致で判定しています。'
  },
  ko: {
    basis: '완료된 지출만 집계합니다 (예정·미확정 제외).',
    pending: '예정(미지급) {count}건 {amount}은 포함되지 않습니다.',
    other: '다른 통화 지출 {list}은 포함되지 않습니다.',
    unknown: '통화를 알 수 없는 지출 {count}건은 포함되지 않습니다 (0이 아닙니다).',
    unclassified: '카테고리가 없는 지출 {count}건은 포함되지 않습니다.',
    negative: '환불·마이너스 {count}건 {amount}을 차감했습니다.',
    outside: '이 기간은 예산 시작일·종료일 범위 밖입니다.',
    category: '카테고리는 거래에 저장된 카테고리 문자열과의 완전 일치로 판단합니다.'
  }
}
const note = (key: string, values: Record<string, string | number> = {}) => (notesText[locale.value] || notesText.ja)[key].replace(/[{](\w+)[}]/g, (_: string, name: string) => String(values[name] ?? ''))
const evidenceNotes = (budget: any) => {
  const s = budget.spending
  if (!s) return []
  const notes = [note('basis')]
  if (s.outsideBudgetDates) notes.push(note('outside'))
  if (s.categoryMatch === 'category_text') notes.push(note('category'))
  if (s.pendingForecast?.count) notes.push(note('pending', { count: s.pendingForecast.count, amount: formatCurrency(s.pendingForecast.amount, budget.currency) }))
  if (s.otherCurrencies?.length) notes.push(note('other', { list: s.otherCurrencies.map((g: any) => `${formatCurrency(g.amount, g.currency)} (${g.count})`).join(', ') }))
  if (s.unknownCurrency?.count) notes.push(note('unknown', { count: s.unknownCurrency.count }))
  if (s.unclassified?.count) notes.push(note('unclassified', { count: s.unclassified.count }))
  if (s.negative?.count) notes.push(note('negative', { count: s.negative.count, amount: formatCurrency(s.negative.amount, budget.currency) }))
  return notes
}

let loadTicket = 0
const loadBudgets = async () => {
  const ticket = ++loadTicket, scope = tokenClaims(userStore.token), rows = navi.loading()
  isLoading.value = true
  try {
    const data = await $fetch('/api/budgets?active=true', { headers: userStore.authHeader })
    const current = tokenClaims(userStore.token)
    if (ticket !== loadTicket || scope?.userId !== current?.userId || scope?.organizationId !== current?.organizationId) return
    budgets.value = data.budgets
    navi.loaded(rows)
  } catch (error) {
    console.error('Failed to load budgets:', error)
  } finally {
    isLoading.value = false
  }
}

const openModal = (budget?: any) => {
  navi.clear()
  if (budget) {
    editingBudget.value = budget
    form.name = budget.name
    form.category = budget.category || ''
    form.amount = budget.amount
    form.currency = budget.currency || ''
    form.period = budget.period
    form.alertThreshold = budget.alertThreshold
    form.isActive = budget.isActive
  } else {
    editingBudget.value = null
    form.name = ''
    form.category = ''
    form.amount = 0
    form.currency = 'JPY'
    form.period = 'monthly'
    form.alertThreshold = 80
    form.isActive = true
  }
  showModal.value = true
}

const saveBudget = async () => {
  try {
    if (editingBudget.value) {
      await $fetch(`/api/budgets/${editingBudget.value.id}`, {
        method: 'PUT',
        body: form,
        headers: userStore.authHeader
      })
    } else {
      await $fetch('/api/budgets', {
        method: 'POST',
        body: form,
        headers: userStore.authHeader
      })
    }
    showModal.value = false
    loadBudgets()
  } catch (error) {
    console.error('Failed to save budget:', error)
  }
}

const deleteBudget = async (id: string) => {
  if (!confirm('Are you sure you want to delete this budget?')) return
  try {
    await $fetch(`/api/budgets/${id}`, { method: 'DELETE', headers: userStore.authHeader })
    navi.deleted(id)
    loadBudgets()
  } catch (error) {
    console.error('Failed to delete budget:', error)
  }
}

// The saved currency decides the symbol; the UI language only decides number formatting.
const formatCurrency = (value: number, currency?: string) => {
  const numberLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${new Intl.NumberFormat(numberLocale).format(value)} (${t('common.unknown')})`
  return new Intl.NumberFormat(numberLocale, { style: 'currency', currency }).format(value)
}

const getBudgetColor = (budget: any) => {
  if (budget.isOverBudget) return 'bg-red-500'
  if (budget.isNearLimit) return 'bg-yellow-500'
  return 'bg-green-500'
}

const getProgressColor = (budget: any) => {
  if (budget.isOverBudget) return 'bg-red-500'
  if (budget.isNearLimit) return 'bg-yellow-500'
  return 'bg-green-500'
}

// A Navi budget change of this same actor and company reloads the list (currency, period and warnings come from the server).
watch(() => assistant.companyResourceSequence, () => {
  const saved = assistant.companyResource, scope = tokenClaims(userStore.token)
  if (saved && saved.actorId === scope?.userId && saved.organizationId === scope?.organizationId && saved.kinds.includes('budget')) loadBudgets()
})
onMounted(() => loadBudgets())
</script>
