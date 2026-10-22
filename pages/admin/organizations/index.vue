<template>
  <LegacyAdministrationUnavailable />
</template>

<script setup lang="ts">
import LegacyAdministrationUnavailable from '~/components/admin/LegacyAdministrationUnavailable.vue'
definePageMeta({ middleware: ['admin'] })
</script>
