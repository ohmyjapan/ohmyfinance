<template>
  <footer class="bg-white dark:bg-background-darkPaper border-t border-gray-200 dark:border-gray-700 py-4">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 dark:text-gray-400">
        <div class="mb-2 md:mb-0">
          &copy; {{ new Date().getFullYear() }} OhMyFinance. All rights reserved.
        </div>
        <div class="flex space-x-6">
          <a href="#" class="hover:text-gray-700 dark:hover:text-gray-300">Privacy Policy</a>
          <a href="#" class="hover:text-gray-700 dark:hover:text-gray-300">Terms of Service</a>
          <a href="#" class="hover:text-gray-700 dark:hover:text-gray-300">Help Center</a>
        </div>
      </div>
    </div>
  </footer>
</template>
