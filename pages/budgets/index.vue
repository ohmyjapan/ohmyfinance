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
        <div class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(stats.totalBudget) }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.totalSpent') }}</div>
        <div class="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(stats.totalSpent) }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.remaining') }}</div>
        <div class="text-2xl font-bold font-mono" :class="stats.remaining >= 0 ? 'text-green-600' : 'text-red-600'">
          {{ formatCurrency(stats.remaining) }}
        </div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('budgets.overBudget') }}</div>
        <div class="text-2xl font-bold font-mono text-red-600">{{ stats.overBudgetCount }}</div>
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
                </p>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <div class="text-right">
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ formatCurrency(budget.spent) }} / {{ formatCurrency(budget.amount) }}
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
                {{ formatCurrency(budget.remaining) }} {{ t('budgets.remaining') }}
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
            {{ t('budgets.overBudgetBy', { amount: formatCurrency(Math.abs(budget.remaining)) }) }}
          </div>
          <div v-else-if="budget.isNearLimit" class="mt-2 flex items-center text-yellow-600 text-sm">
            <AlertTriangle class="h-4 w-4 mr-1" />
            {{ t('budgets.approachingLimit') }}
          </div>
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

const { t, locale } = useI18n()

const isLoading = ref(false)
const showModal = ref(false)
const budgets = ref<any[]>([])
const editingBudget = ref<any>(null)

const form = reactive({
  name: '',
  category: '',
  amount: 0,
  period: 'monthly',
  alertThreshold: 80,
  isActive: true
})

const stats = computed(() => {
  const totalBudget = budgets.value.reduce((sum, b) => sum + b.amount, 0)
  const totalSpent = budgets.value.reduce((sum, b) => sum + b.spent, 0)
  const overBudgetCount = budgets.value.filter(b => b.isOverBudget).length
  return {
    totalBudget,
    totalSpent,
    remaining: totalBudget - totalSpent,
    overBudgetCount
  }
})

const loadBudgets = async () => {
  isLoading.value = true
  try {
    const data = await $fetch('/api/budgets?active=true')
    budgets.value = data.budgets
  } catch (error) {
    console.error('Failed to load budgets:', error)
  } finally {
    isLoading.value = false
  }
}

const openModal = (budget?: any) => {
  if (budget) {
    editingBudget.value = budget
    form.name = budget.name
    form.category = budget.category || ''
    form.amount = budget.amount
    form.period = budget.period
    form.alertThreshold = budget.alertThreshold
    form.isActive = budget.isActive
  } else {
    editingBudget.value = null
    form.name = ''
    form.category = ''
    form.amount = 0
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
        body: form
      })
    } else {
      await $fetch('/api/budgets', {
        method: 'POST',
        body: form
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
    await $fetch(`/api/budgets/${id}`, { method: 'DELETE' })
    loadBudgets()
  } catch (error) {
    console.error('Failed to delete budget:', error)
  }
}

const formatCurrency = (value: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
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

onMounted(() => loadBudgets())
</script>
