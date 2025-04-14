<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">Receipt</h3>
    </div>
    <div class="p-6">
      <!-- If there's a receipt attached -->
      <div v-if="receipt" class="space-y-4">
        <div class="flex