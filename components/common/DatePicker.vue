<!-- components/common/DatePicker.vue -->
<template>
  <ClientOnly>
    <VueDatePicker
      v-model="internalValue"
      :locale="locale"
      :format="displayFormat"
      :preview-format="displayFormat"
      :enable-time-picker="enableTime"
      :dark="isDark"
      :placeholder="placeholder"
      :min-date="minDate"
      :max-date="maxDate"
      :disabled="disabled"
      :readonly="readonly"
      :clearable="clearable"
      :auto-apply="autoApply"
      :month-change-on-scroll="false"
      :text-input="textInput"
      :teleport="true"
      :input-class-name="inputClassName"
      @update:model-value="handleUpdate"
    >
      <template #input-icon>
        <Calendar class="w-4 h-4 text-gray-400" />
      </template>
      <template #clear-icon>
        <X class="w-4 h-4 text-gray-400 hover:text-gray-600" />
      </template>
    </VueDatePicker>
    <template #fallback>
      <input
        type="date"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        class="w-full h-11 px-3 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-lg"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </template>
  </ClientOnly>
</template>

<script setup lang="ts">
import { Calendar, X } from 'lucide-vue-next'
import { ref, computed, watch } from 'vue'

// VueDatePicker is registered globally via plugin (vue-datepicker.client.ts)

const props = withDefaults(defineProps<{
  modelValue?: string | Date | null
  placeholder?: string
  enableTime?: boolean
  minDate?: Date | string
  maxDate?: Date | string
  disabled?: boolean
  readonly?: boolean
  clearable?: boolean
  autoApply?: boolean
  textInput?: boolean
  format?: string
}>(), {
  placeholder: '',
  enableTime: false,
  disabled: false,
  readonly: false,
  clearable: true,
  autoApply: true,
  textInput: true,
  format: 'yyyy-MM-dd'
})

const emit = defineEmits(['update:modelValue'])

const { locale } = useI18n()
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')

const displayFormat = computed(() => {
  if (props.enableTime) {
    return locale.value === 'ja' ? 'yyyy年MM月dd日 HH:mm' : 'yyyy-MM-dd HH:mm'
  }
  return locale.value === 'ja' ? 'yyyy年MM月dd日' : 'yyyy-MM-dd'
})

const inputClassName = computed(() =>
  'w-full h-11 px-3 pl-10 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent transition-shadow text-sm'
)

// Internal value handling
const internalValue = ref<Date | null>(null)

// Watch for external changes
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    internalValue.value = typeof newVal === 'string' ? new Date(newVal) : newVal
  } else {
    internalValue.value = null
  }
}, { immediate: true })

const handleUpdate = (value: Date | null) => {
  if (value) {
    // Emit in the format expected (ISO string for date-only, or full ISO for datetime)
    if (props.enableTime) {
      emit('update:modelValue', value.toISOString())
    } else {
      // Format as YYYY-MM-DD for date-only
      const year = value.getFullYear()
      const month = String(value.getMonth() + 1).padStart(2, '0')
      const day = String(value.getDate()).padStart(2, '0')
      emit('update:modelValue', `${year}-${month}-${day}`)
    }
  } else {
    emit('update:modelValue', null)
  }
}
</script>

<style>
/* Custom styling to match app theme */
.dp__theme_dark {
  --dp-background-color: #1f2937;
  --dp-text-color: #f3f4f6;
  --dp-hover-color: #374151;
  --dp-hover-text-color: #f3f4f6;
  --dp-hover-icon-color: #f3f4f6;
  --dp-primary-color: #C0392B;
  --dp-primary-text-color: #ffffff;
  --dp-secondary-color: #4b5563;
  --dp-border-color: #4b5563;
  --dp-menu-border-color: #4b5563;
  --dp-input-border-color: #4b5563;
  --dp-input-background-color: #1f2937;
  --dp-icon-color: #9ca3af;
  --dp-disabled-color: #374151;
}

.dp__theme_light {
  --dp-background-color: #ffffff;
  --dp-text-color: #1f2937;
  --dp-hover-color: #F3D9D7;
  --dp-hover-text-color: #1f2937;
  --dp-hover-icon-color: #1f2937;
  --dp-primary-color: #C0392B;
  --dp-primary-text-color: #ffffff;
  --dp-secondary-color: #e5e7eb;
  --dp-border-color: #d1d5db;
  --dp-menu-border-color: #d1d5db;
  --dp-input-border-color: #d1d5db;
  --dp-input-background-color: #ffffff;
  --dp-icon-color: #9ca3af;
  --dp-disabled-color: #f3f4f6;
}

/* Calendar menu styling */
.dp__menu {
  border-radius: 0.75rem;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
}

.dp__calendar_header_item {
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
}

.dp__cell_inner {
  border-radius: 0.5rem;
  font-size: 0.875rem;
}

.dp__today {
  border-color: var(--dp-primary-color);
}

.dp__active_date {
  background-color: var(--dp-primary-color);
}

.dp__action_button {
  border-radius: 0.5rem;
  font-weight: 500;
}

.dp__input_wrap {
  position: relative;
}

.dp__input_icon {
  left: 0.75rem;
}

.dp__clear_icon {
  right: 0.75rem;
}

/* Month/Year selector styling */
.dp__month_year_select {
  font-weight: 600;
}

.dp__overlay_cell_active {
  background-color: var(--dp-primary-color);
}

/* Ensure datepicker appears above modals */
.dp__menu {
  z-index: 9999 !important;
}

.dp__overlay {
  z-index: 9998 !important;
}
</style>
