<template>
  <div class="relative" ref="containerRef">
    <!-- Input -->
    <div
      @click="toggle"
      class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg flex items-center cursor-pointer hover:border-primary-main dark:hover:border-primary-main transition-colors"
      :class="{ 'ring-2 ring-primary-main border-transparent': isOpen }"
    >
      <CalendarIcon class="w-4 h-4 text-gray-400 mr-2" />
      <span v-if="displayValue" class="text-gray-900 dark:text-gray-100 text-sm">
        {{ displayValue }}
      </span>
      <span v-else class="text-gray-400 text-sm">{{ placeholder }}</span>
      <ChevronDown
        class="w-4 h-4 text-gray-400 ml-auto transition-transform"
        :class="{ 'rotate-180': isOpen }"
      />
    </div>

    <!-- Calendar Dropdown -->
    <Transition name="dropdown">
      <div
        v-if="isOpen"
        class="absolute z-50 mt-2 w-full min-w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <!-- Header -->
        <div class="bg-primary-main text-white p-4">
          <div class="text-sm opacity-80">{{ selectedYear }}年</div>
          <div class="text-2xl font-bold">{{ headerDisplay }}</div>
        </div>

        <!-- Month Navigation -->
        <div class="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <button
            @click="prevMonth"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronLeft class="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <div class="font-medium text-gray-900 dark:text-gray-100">
            {{ currentYear }}年 {{ currentMonth + 1 }}月
          </div>
          <button
            @click="nextMonth"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronRight class="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <!-- Weekday Headers -->
        <div class="grid grid-cols-7 gap-0 px-2 py-2 bg-gray-50 dark:bg-gray-900/50">
          <div
            v-for="day in weekDays"
            :key="day"
            class="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1"
          >
            {{ day }}
          </div>
        </div>

        <!-- Calendar Grid -->
        <div class="grid grid-cols-7 gap-0 p-2">
          <button
            v-for="(day, index) in calendarDays"
            :key="index"
            @click="day.date && selectDate(day.date)"
            :disabled="!day.date || day.isDisabled"
            class="aspect-square flex items-center justify-center text-sm rounded-lg transition-all"
            :class="getDayClasses(day)"
          >
            {{ day.day }}
          </button>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <button
            @click="selectToday"
            class="text-sm text-primary-main hover:text-primary-dark font-medium"
          >
            今日
          </button>
          <button
            @click="clear"
            class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            クリア
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue?: string | null
  placeholder?: string
  minDate?: string
  maxDate?: string
}>(), {
  placeholder: '日付を選択',
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth())

const weekDays = ['日', '月', '火', '水', '木', '金', '土']

// Parse model value to Date
const selectedDate = computed(() => {
  if (props.modelValue) {
    return new Date(props.modelValue)
  }
  return null
})

const selectedYear = computed(() => selectedDate.value?.getFullYear() || new Date().getFullYear())

const displayValue = computed(() => {
  if (!selectedDate.value) return ''
  const y = selectedDate.value.getFullYear()
  const m = selectedDate.value.getMonth() + 1
  const d = selectedDate.value.getDate()
  return `${y}年${m}月${d}日`
})

const headerDisplay = computed(() => {
  if (!selectedDate.value) {
    const today = new Date()
    return `${today.getMonth() + 1}月${today.getDate()}日`
  }
  const m = selectedDate.value.getMonth() + 1
  const d = selectedDate.value.getDate()
  const dayOfWeek = weekDays[selectedDate.value.getDay()]
  return `${m}月${d}日 (${dayOfWeek})`
})

// Generate calendar days
const calendarDays = computed(() => {
  const days: Array<{ day: number | string; date: Date | null; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; isDisabled: boolean }> = []

  const firstDay = new Date(currentYear.value, currentMonth.value, 1)
  const lastDay = new Date(currentYear.value, currentMonth.value + 1, 0)
  const startPadding = firstDay.getDay()

  // Previous month padding
  const prevMonthLast = new Date(currentYear.value, currentMonth.value, 0)
  for (let i = startPadding - 1; i >= 0; i--) {
    const d = prevMonthLast.getDate() - i
    days.push({
      day: d,
      date: new Date(currentYear.value, currentMonth.value - 1, d),
      isCurrentMonth: false,
      isToday: false,
      isSelected: false,
      isDisabled: true
    })
  }

  // Current month days
  const today = new Date()
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(currentYear.value, currentMonth.value, d)
    const isToday = date.toDateString() === today.toDateString()
    const isSelected = selectedDate.value ? date.toDateString() === selectedDate.value.toDateString() : false

    days.push({
      day: d,
      date,
      isCurrentMonth: true,
      isToday,
      isSelected,
      isDisabled: false
    })
  }

  // Next month padding
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    days.push({
      day: d,
      date: new Date(currentYear.value, currentMonth.value + 1, d),
      isCurrentMonth: false,
      isToday: false,
      isSelected: false,
      isDisabled: true
    })
  }

  return days
})

const getDayClasses = (day: typeof calendarDays.value[0]) => {
  const classes: string[] = []

  if (!day.date || day.isDisabled) {
    classes.push('text-gray-300 dark:text-gray-600 cursor-not-allowed')
  } else if (day.isSelected) {
    classes.push('bg-primary-main text-white font-medium shadow-md')
  } else if (day.isToday) {
    classes.push('bg-primary-light dark:bg-primary-dark/30 text-primary-main dark:text-primary-light font-medium')
  } else if (!day.isCurrentMonth) {
    classes.push('text-gray-400 dark:text-gray-500')
  } else {
    classes.push('text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700')
  }

  return classes
}

const toggle = () => {
  isOpen.value = !isOpen.value
  if (isOpen.value && selectedDate.value) {
    currentYear.value = selectedDate.value.getFullYear()
    currentMonth.value = selectedDate.value.getMonth()
  }
}

const prevMonth = () => {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

const nextMonth = () => {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

const selectDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  emit('update:modelValue', `${year}-${month}-${day}`)
  isOpen.value = false
}

const selectToday = () => {
  selectDate(new Date())
}

const clear = () => {
  emit('update:modelValue', null)
  isOpen.value = false
}

// Click outside to close
const handleClickOutside = (e: MouseEvent) => {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
