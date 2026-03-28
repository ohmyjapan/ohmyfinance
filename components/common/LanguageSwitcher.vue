<template>
  <div class="relative">
    <button
      @click="isOpen = !isOpen"
      class="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md"
    >
      <Globe class="h-4 w-4" />
      <span>{{ currentLocaleName }}</span>
      <ChevronDown class="h-3 w-3" :class="{ 'rotate-180': isOpen }" />
    </button>

    <div
      v-if="isOpen"
      class="absolute right-0 mt-1 w-32 bg-white dark:bg-white/5 rounded-md shadow-lg border border-gray-200 dark:border-white/10 z-50"
    >
      <button
        v-for="loc in availableLocales"
        :key="loc.code"
        @click="switchLocale(loc.code)"
        :class="[
          'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/10',
          locale === loc.code ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
        ]"
      >
        {{ loc.name }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Globe, ChevronDown } from 'lucide-vue-next'

const { locale, locales, setLocale } = useI18n()

const isOpen = ref(false)

const availableLocales = computed(() => {
  return locales.value.map(loc => {
    if (typeof loc === 'string') {
      return { code: loc, name: loc }
    }
    return { code: loc.code, name: loc.name || loc.code }
  })
})

const currentLocaleName = computed(() => {
  const current = availableLocales.value.find(l => l.code === locale.value)
  return current?.name || locale.value
})

const switchLocale = async (code: string) => {
  await setLocale(code)
  isOpen.value = false
}

// Close dropdown when clicking outside
const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.closest('.relative')) {
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
