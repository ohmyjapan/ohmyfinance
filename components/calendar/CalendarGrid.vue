<template>
  <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
    <!-- Floating Drag Ghost (follows cursor with shadow) -->
    <Teleport to="body">
      <div
        v-if="draggedPayment && isDragging"
        class="fixed z-[9999] pointer-events-none transition-transform duration-75"
        :style="{
          left: `${dragPosition.x}px`,
          top: `${dragPosition.y}px`,
          transform: 'translate(-50%, -120%)'
        }"
      >
        <div
          :class="[
            'px-3 py-2 rounded-lg border-2 backdrop-blur-sm',
            getDragGhostClass(draggedPayment)
          ]"
          style="box-shadow: 0 12px 28px rgba(0,0,0,0.25), 0 8px 12px rgba(0,0,0,0.15);"
        >
          <div class="flex items-center gap-2 text-sm">
            <GripVertical :class="['w-4 h-4', getDragIconColor(draggedPayment)]" />
            <span :class="['font-semibold', getDragIconColor(draggedPayment)]">{{ formatCurrency(draggedPayment.amount, draggedPayment.currency) }}</span>
            <span class="text-gray-700 dark:text-gray-200 max-w-[120px] truncate">{{ draggedPayment.title }}</span>
          </div>
        </div>
        <!-- Shadow underneath -->
        <div
          class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2/3 h-2 rounded-full bg-black/15 blur-sm"
        />
      </div>
    </Teleport>

    <!-- Calendar Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b dark:border-white/10 bg-gradient-to-r from-primary-light/20 to-transparent dark:from-primary-dark/20">
      <div class="flex items-center space-x-4">
        <button
          @click="$emit('previous-month')"
          class="p-2 hover:bg-white/50 dark:hover:bg-white/[0.07] rounded-full transition-all duration-200 hover:scale-110"
        >
          <ChevronLeft class="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </button>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white min-w-[160px] text-center">
          {{ monthYearLabel }}
        </h2>
        <button
          @click="$emit('next-month')"
          class="p-2 hover:bg-white/50 dark:hover:bg-white/[0.07] rounded-full transition-all duration-200 hover:scale-110"
        >
          <ChevronRight class="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </button>
      </div>
      <div class="flex items-center gap-3">
        <!-- Holiday Legend -->
        <div class="hidden sm:flex items-center gap-3 text-xs">
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-red-500"></span>
            <span class="text-gray-500 dark:text-gray-400">{{ locale === 'ko' ? '일본' : '日本' }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-blue-500"></span>
            <span class="text-gray-500 dark:text-gray-400">{{ locale === 'ko' ? '한국' : '韓国' }}</span>
          </div>
        </div>
        <button
          @click="$emit('go-today')"
          class="px-4 py-2 text-sm font-medium text-primary-main hover:bg-primary-light dark:hover:bg-primary-dark/20 rounded-md transition-all duration-200"
        >
          {{ t('time.today') }}
        </button>
      </div>
    </div>

    <!-- Days of Week -->
    <div class="grid grid-cols-7 border-b dark:border-white/10 bg-gray-50 dark:bg-white/5">
      <div
        v-for="(day, index) in daysOfWeek"
        :key="day"
        :class="[
          'py-3 text-center text-sm font-medium',
          index === 0 ? 'text-red-500 dark:text-red-400' : '',
          index === 6 ? 'text-blue-500 dark:text-blue-400' : '',
          index > 0 && index < 6 ? 'text-gray-500 dark:text-gray-400' : ''
        ]"
      >
        {{ day }}
      </div>
    </div>

    <!-- Calendar Grid -->
    <div class="grid grid-cols-7">
      <div
        v-for="(day, index) in calendarDays"
        :key="index"
        :class="[
          'min-h-[120px] p-2 border-b border-r dark:border-white/10 transition-all duration-200 cursor-pointer group relative',
          getDayBackgroundClass(day, index),
          selectedDateString === day.dateString ? 'ring-2 ring-primary-main ring-inset shadow-inner' : '',
          index % 7 === 6 ? 'border-r-0' : '',
          dragOverDate === day.dateString && draggedPayment && draggedPayment.dueDate.split('T')[0] !== day.dateString ? 'ring-2 ring-primary-main ring-inset scale-[1.02] shadow-lg z-10' : ''
        ]"
        @click="handleDayClick(day, $event)"
        @dragover.prevent="handleDragOver(day)"
        @dragleave="handleDragLeave"
        @drop.prevent="handleDrop(day)"
      >
        <!-- Date Number & Holiday Indicator -->
        <div class="flex justify-between items-start mb-1">
          <div class="flex items-center gap-1">
            <span
              :class="[
                'inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium transition-all duration-200',
                day.isToday ? 'bg-primary-main text-white shadow-md' : '',
                !day.isCurrentMonth ? 'text-gray-300 dark:text-gray-600' : '',
                day.isCurrentMonth && !day.isToday && day.isWeekend && index % 7 === 0 ? 'text-red-500 dark:text-red-400' : '',
                day.isCurrentMonth && !day.isToday && day.isWeekend && index % 7 === 6 ? 'text-blue-500 dark:text-blue-400' : '',
                day.isCurrentMonth && !day.isToday && !day.isWeekend && day.holidays.length === 0 ? 'text-gray-900 dark:text-white' : '',
                day.isCurrentMonth && !day.isToday && day.holidays.length > 0 ? 'text-red-500 dark:text-red-400' : ''
              ]"
            >
              {{ day.date.getDate() }}
            </span>
            <!-- Holiday Country Flags/Indicators -->
            <div v-if="day.holidays.length > 0" class="flex gap-0.5">
              <span
                v-for="(holiday, hIdx) in day.holidays.slice(0, 2)"
                :key="hIdx"
                :class="[
                  'w-1.5 h-1.5 rounded-full',
                  holiday.country === 'jp' ? 'bg-red-500' : '',
                  holiday.country === 'kr' ? 'bg-blue-500' : '',
                  holiday.country === 'both' ? 'bg-gradient-to-r from-red-500 to-blue-500' : ''
                ]"
              />
            </div>
          </div>
          <!-- Add Button (appears on hover) -->
          <button
            v-if="day.isCurrentMonth"
            @click.stop="emit('add-payment', day.dateString)"
            class="p-1 hover:bg-gray-200 dark:hover:bg-white/[0.07] rounded opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
            :title="t('calendar.addPayment')"
          >
            <Plus class="h-4 w-4 text-gray-400 group-hover:text-primary-main" />
          </button>
        </div>

        <!-- Holiday Names -->
        <div v-if="day.holidays.length > 0 && day.isCurrentMonth" class="mb-1">
          <div
            v-for="(holiday, hIdx) in day.holidays.slice(0, 2)"
            :key="hIdx"
            :class="[
              'text-[10px] leading-tight truncate px-1 py-0.5 rounded',
              holiday.country === 'jp' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : '',
              holiday.country === 'kr' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : '',
              holiday.country === 'both' ? 'bg-primary-main/20 dark:bg-primary-main/20 text-primary-dark dark:text-primary-light' : ''
            ]"
            :title="locale === 'ko' ? holiday.name : holiday.name"
          >
            <span class="flex items-center gap-1">
              <component
                :is="holiday.country === 'jp' ? FlagJp : holiday.country === 'kr' ? FlagKr : Star"
                class="w-2.5 h-2.5 flex-shrink-0"
              />
              {{ locale === 'ko' ? holiday.name : holiday.name }}
            </span>
          </div>
          <div
            v-if="day.holidays.length > 2"
            class="text-[10px] text-gray-500 dark:text-gray-400 pl-1"
          >
            +{{ day.holidays.length - 2 }}
          </div>
        </div>

        <!-- Payment indicators -->
        <div class="space-y-1">
          <div
            v-for="payment in day.payments.slice(0, 2)"
            :key="payment.id"
            :class="[
              'flex items-center gap-1 px-2 py-1 rounded text-xs cursor-grab transition-all duration-150 hover:scale-[1.02] hover:shadow-sm',
              getPaymentClass(payment),
              draggedPayment?.id === payment.id ? 'opacity-50 ring-2 ring-primary-main' : ''
            ]"
            draggable="true"
            @dragstart="handleDragStart(payment, $event)"
            @dragend="handleDragEnd"
            @click.stop
          >
            <!-- Drag Handle -->
            <GripVertical :class="['flex-shrink-0 w-3 h-3 cursor-grab active:cursor-grabbing', getHandleColor(payment)]" />
            <button
              v-if="payment.status === 'pending' || payment.status === 'overdue'"
              @click.stop="emit('mark-completed', payment)"
              class="flex-shrink-0 w-4 h-4 rounded-full border-2 border-current hover:bg-success-main hover:border-success-main hover:text-white transition-all"
              :title="t('calendar.markComplete')"
            />
            <div
              v-else-if="payment.status === 'completed'"
              class="flex-shrink-0 w-4 h-4 rounded-full bg-success-main flex items-center justify-center"
            >
              <Check class="h-2.5 w-2.5 text-white" />
            </div>
            <div
              @click.stop="emit('edit-payment', payment)"
              class="flex-1 truncate hover:underline"
            >
              <span class="font-medium">{{ formatCurrency(payment.amount, payment.currency) }}</span>
              <span class="ml-1 opacity-75">{{ payment.title }}</span>
            </div>
          </div>
          <div
            v-if="day.payments.length > 2"
            class="text-xs text-gray-500 dark:text-gray-400 pl-2 cursor-pointer hover:text-primary-main"
            @click.stop="emit('show-day-detail', day.dateString)"
          >
            +{{ day.payments.length - 2 }} {{ t('calendarGrid.morePayments') }}
          </div>
        </div>

        <!-- Drop Preview (shows where payment will land, only if different from origin) -->
        <div
          v-if="draggedPayment && dragOverDate === day.dateString && day.isCurrentMonth && draggedPayment.dueDate.split('T')[0] !== day.dateString"
          class="mt-1 animate-pulse"
        >
          <div
            :class="[
              'flex items-center gap-1 px-2 py-1 rounded text-xs border-2 border-dashed',
              getDropPreviewClass(draggedPayment)
            ]"
          >
            <div class="flex-shrink-0 w-3 h-3 rounded-full border-2 border-current opacity-50" />
            <div class="flex-1 truncate opacity-70">
              <span class="font-medium">{{ formatCurrency(draggedPayment.amount, draggedPayment.currency) }}</span>
              <span class="ml-1">{{ draggedPayment.title }}</span>
            </div>
          </div>
        </div>

        <!-- Click to add hint (shown on hover for empty days) -->
        <div
          v-if="day.isCurrentMonth && day.payments.length === 0 && day.holidays.length === 0 && !draggedPayment"
          class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
        >
          <span class="text-xs text-gray-400 dark:text-gray-500 bg-white/80 dark:bg-slate-800/80 px-2 py-1 rounded">
            {{ t('calendar.clickToAdd') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onUnmounted } from 'vue'
import { ChevronLeft, ChevronRight, Plus, Check, Star, GripVertical } from 'lucide-vue-next'
import type { Payment, CalendarDay, CalendarHoliday } from '~/types/calendar'
import { useHolidays } from '~/composables/useHolidays'

const { t, locale } = useI18n()
const { getHolidayForDate } = useHolidays()

// Simple flag components
const FlagJp = {
  render() {
    return h('svg', { viewBox: '0 0 16 16', class: 'w-2.5 h-2.5' }, [
      h('circle', { cx: '8', cy: '8', r: '6', fill: 'white', stroke: '#ccc', 'stroke-width': '0.5' }),
      h('circle', { cx: '8', cy: '8', r: '3', fill: '#bc002d' })
    ])
  }
}

const FlagKr = {
  render() {
    return h('svg', { viewBox: '0 0 16 16', class: 'w-2.5 h-2.5' }, [
      h('circle', { cx: '8', cy: '8', r: '6', fill: 'white', stroke: '#ccc', 'stroke-width': '0.5' }),
      h('circle', { cx: '8', cy: '6', r: '2.5', fill: '#c60c30' }),
      h('circle', { cx: '8', cy: '10', r: '2.5', fill: '#003478' })
    ])
  }
}

// Format date to YYYY-MM-DD in local timezone (JST)
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const props = defineProps<{
  currentMonth: Date
  payments: Payment[]
}>()

const emit = defineEmits<{
  (e: 'previous-month'): void
  (e: 'next-month'): void
  (e: 'go-today'): void
  (e: 'select-date', date: Date): void
  (e: 'add-payment', dateString: string): void
  (e: 'edit-payment', payment: Payment): void
  (e: 'mark-completed', payment: Payment): void
  (e: 'move-payment', payment: Payment, newDate: string): void
  (e: 'show-day-detail', dateString: string): void
}>()

const selectedDateString = ref<string>('')
const draggedPayment = ref<Payment | null>(null)
const dragOverDate = ref<string | null>(null)
const isDragging = ref(false)
const dragPosition = ref({ x: 0, y: 0 })

// Track mouse position during drag
const handleMouseMove = (event: MouseEvent) => {
  dragPosition.value = {
    x: event.clientX,
    y: event.clientY
  }
}

// Also track via drag event for smoother updates
const handleDrag = (event: DragEvent) => {
  if (event.clientX !== 0 || event.clientY !== 0) {
    dragPosition.value = {
      x: event.clientX,
      y: event.clientY
    }
  }
}

// Drag and Drop handlers
const handleDragStart = (payment: Payment, event: DragEvent) => {
  draggedPayment.value = payment
  isDragging.value = true

  // Set initial position
  dragPosition.value = {
    x: event.clientX,
    y: event.clientY
  }

  // Add global mouse/drag listeners for tracking
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('drag', handleDrag as EventListener)

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', payment.id)
    // Create invisible drag image (we show our own ghost)
    const img = new Image()
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    event.dataTransfer.setDragImage(img, 0, 0)
  }
}

const handleDragEnd = () => {
  draggedPayment.value = null
  dragOverDate.value = null
  isDragging.value = false

  // Clean up listeners
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('drag', handleDrag as EventListener)
}

// Cleanup on unmount
onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('drag', handleDrag as EventListener)
})

const handleDragOver = (day: CalendarDay) => {
  if (draggedPayment.value && day.isCurrentMonth) {
    dragOverDate.value = day.dateString
  }
}

const handleDragLeave = () => {
  dragOverDate.value = null
}

const handleDrop = (day: CalendarDay) => {
  if (draggedPayment.value && day.isCurrentMonth) {
    const payment = draggedPayment.value
    const newDate = day.dateString

    // Only emit if the date actually changed
    if (payment.dueDate.split('T')[0] !== newDate) {
      emit('move-payment', payment, newDate)
    }
  }
  draggedPayment.value = null
  dragOverDate.value = null
}

// Handle click on day cell - if clicking empty area, open add modal
const handleDayClick = (day: CalendarDay, event: MouseEvent) => {
  const target = event.target as HTMLElement

  // Check if clicking on payment or button
  if (target.closest('button') || target.closest('[data-payment]')) {
    return
  }

  selectedDateString.value = day.dateString

  if (day.isCurrentMonth) {
    if (day.payments.length > 0) {
      emit('show-day-detail', day.dateString)
    } else {
      emit('add-payment', day.dateString)
    }
  } else {
    emit('select-date', day.date)
  }
}

const daysOfWeek = computed(() => [
  t('calendar.daysShort.sun'),
  t('calendar.daysShort.mon'),
  t('calendar.daysShort.tue'),
  t('calendar.daysShort.wed'),
  t('calendar.daysShort.thu'),
  t('calendar.daysShort.fri'),
  t('calendar.daysShort.sat')
])

const monthYearLabel = computed(() => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return props.currentMonth.toLocaleDateString(dateLocale, {
    month: 'long',
    year: 'numeric'
  })
})

const calendarDays = computed((): CalendarDay[] => {
  const year = props.currentMonth.getFullYear()
  const month = props.currentMonth.getMonth()

  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)

  const startDate = new Date(firstDayOfMonth)
  startDate.setDate(startDate.getDate() - firstDayOfMonth.getDay())

  const endDate = new Date(lastDayOfMonth)
  endDate.setDate(endDate.getDate() + (6 - lastDayOfMonth.getDay()))

  const days: CalendarDay[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const current = new Date(startDate)
  while (current <= endDate) {
    const dateString = formatLocalDate(current)
    const dayPayments = props.payments.filter(p =>
      p.dueDate.split('T')[0] === dateString
    )

    // Get holidays for this date
    const holidayData = getHolidayForDate(dateString)
    const holidays: CalendarHoliday[] = holidayData.map(h => ({
      name: locale.value === 'ko' ? h.nameKo : h.nameJa,
      country: h.country,
      type: h.type
    }))

    const dayOfWeek = current.getDay()

    days.push({
      date: new Date(current),
      dateString,
      isCurrentMonth: current.getMonth() === month,
      isToday: current.getTime() === today.getTime(),
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      payments: dayPayments,
      holidays
    })

    current.setDate(current.getDate() + 1)
  }

  return days
})

const getDayBackgroundClass = (day: CalendarDay, index: number): string => {
  const classes: string[] = []

  if (day.isToday) {
    classes.push('bg-primary-light/30 dark:bg-primary-dark/20 hover:bg-primary-light/50 dark:hover:bg-primary-dark/30')
  } else if (!day.isCurrentMonth) {
    classes.push('bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/[0.07]')
  } else if (day.holidays.length > 0) {
    // Holiday background
    const hasJp = day.holidays.some(h => h.country === 'jp' || h.country === 'both')
    const hasKr = day.holidays.some(h => h.country === 'kr' || h.country === 'both')

    if (hasJp && hasKr) {
      classes.push('bg-gradient-to-br from-red-50 to-blue-50 dark:from-red-900/10 dark:to-blue-900/10 hover:from-red-100 hover:to-blue-100 dark:hover:from-red-900/20 dark:hover:to-blue-900/20')
    } else if (hasJp) {
      classes.push('bg-red-50/50 dark:bg-red-900/10 hover:bg-red-100/50 dark:hover:bg-red-900/20')
    } else if (hasKr) {
      classes.push('bg-blue-50/50 dark:bg-blue-900/10 hover:bg-blue-100/50 dark:hover:bg-blue-900/20')
    }
  } else if (day.isWeekend) {
    if (index % 7 === 0) {
      // Sunday
      classes.push('bg-red-50/30 dark:bg-red-900/5 hover:bg-red-50 dark:hover:bg-red-900/10')
    } else {
      // Saturday
      classes.push('bg-blue-50/30 dark:bg-blue-900/5 hover:bg-blue-50 dark:hover:bg-blue-900/10')
    }
  } else {
    classes.push('bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07]/50')
  }

  return classes.join(' ')
}

// Category color mapping
const getCategoryColors = (category: string): { bg: string; text: string; border: string } => {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    'Term Credit Card': {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-500'
    },
    'Personal': {
      bg: 'bg-primary-main/20 dark:bg-primary-main/20',
      text: 'text-primary-dark dark:text-primary-light',
      border: 'border-primary-main'
    },
    'Salary': {
      bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-500'
    },
    'Invoice': {
      bg: 'bg-indigo-100 dark:bg-indigo-900/30',
      text: 'text-indigo-700 dark:text-indigo-300',
      border: 'border-indigo-500'
    },
    'Utilities': {
      bg: 'bg-orange-100 dark:bg-orange-900/30',
      text: 'text-orange-700 dark:text-orange-300',
      border: 'border-orange-500'
    },
    'Rent': {
      bg: 'bg-pink-100 dark:bg-pink-900/30',
      text: 'text-pink-700 dark:text-pink-300',
      border: 'border-pink-500'
    },
    'Subscription': {
      bg: 'bg-cyan-100 dark:bg-cyan-900/30',
      text: 'text-cyan-700 dark:text-cyan-300',
      border: 'border-cyan-500'
    },
    'Insurance': {
      bg: 'bg-teal-100 dark:bg-teal-900/30',
      text: 'text-teal-700 dark:text-teal-300',
      border: 'border-teal-500'
    },
    'Tax': {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      border: 'border-red-500'
    },
    'Loan': {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-500'
    },
    'Other': {
      bg: 'bg-gray-100 dark:bg-white/5',
      text: 'text-gray-700 dark:text-gray-300',
      border: 'border-gray-500'
    }
  }
  return colors[category] || colors['Other']
}

const getPaymentClass = (payment: Payment): string => {
  // Paid/completed items get muted styling with line-through
  if (payment.status === 'paid' || payment.status === 'completed') {
    const colors = getCategoryColors(payment.category)
    return `${colors.bg} ${colors.text} opacity-60 line-through`
  }

  // Overdue items get red background regardless of category
  if (payment.status === 'overdue') {
    return 'bg-error-light dark:bg-error-dark/30 text-error-dark dark:text-error-light'
  }

  // Normal pending items use category colors
  const colors = getCategoryColors(payment.category)
  return `${colors.bg} ${colors.text}`
}

// Get handle color for drag icon based on category
const getHandleColor = (payment: Payment): string => {
  if (payment.status === 'overdue') {
    return 'text-error-main opacity-70 hover:opacity-100'
  }

  const categoryHandleColors: Record<string, string> = {
    'Term Credit Card': 'text-blue-500',
    'Personal': 'text-primary-main',
    'Salary': 'text-emerald-500',
    'Invoice': 'text-indigo-500',
    'Utilities': 'text-orange-500',
    'Rent': 'text-pink-500',
    'Subscription': 'text-cyan-500',
    'Insurance': 'text-teal-500',
    'Tax': 'text-red-500',
    'Loan': 'text-amber-500',
    'Other': 'text-gray-500'
  }

  const color = categoryHandleColors[payment.category] || 'text-gray-500'
  return `${color} opacity-60 hover:opacity-100`
}

// Get drag ghost container class based on category
const getDragGhostClass = (payment: Payment): string => {
  if (payment.status === 'overdue') {
    return 'bg-error-light dark:bg-error-dark/50 border-error-main'
  }

  const colors = getCategoryColors(payment.category)
  return `${colors.bg} ${colors.border}`
}

// Get drag icon text color based on category
const getDragIconColor = (payment: Payment): string => {
  if (payment.status === 'overdue') {
    return 'text-error-dark dark:text-error-light'
  }

  const colors = getCategoryColors(payment.category)
  return colors.text
}

// Get drop preview class (dashed outline in target cell)
const getDropPreviewClass = (payment: Payment): string => {
  if (payment.status === 'overdue') {
    return 'border-error-main text-error-dark dark:text-error-light bg-error-light/30 dark:bg-error-dark/20'
  }

  const colors = getCategoryColors(payment.category)
  return `${colors.border} ${colors.text} ${colors.bg}`
}

const formatCurrency = (amount: number, currency: string): string => {
  const currencyLocale = currency === 'JPY' ? 'ja-JP' : currency === 'KRW' ? 'ko-KR' : 'en-US'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>
