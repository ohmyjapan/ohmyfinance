<template>
  <footer class="bg-white/50 dark:bg-white/5 backdrop-blur-sm border-t border-gray-200 dark:border-white/10 py-4">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 dark:text-gray-400">
        <div class="mb-2 md:mb-0">
          &copy; {{ new Date().getFullYear() }} {{ t('app.name') }}. {{ t('footer.allRightsReserved') }}
        </div>
        <div class="flex space-x-6">
          <a href="#" class="hover:text-gray-700 dark:hover:text-gray-300">{{ t('auth.privacyPolicy') }}</a>
          <a href="#" class="hover:text-gray-700 dark:hover:text-gray-300">{{ t('auth.termsOfService') }}</a>
          <a href="#" class="hover:text-gray-700 dark:hover:text-gray-300">{{ t('footer.helpCenter') }}</a>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const { t } = useI18n()
</script>
