<template><div /></template>
<script setup lang="ts">
import { safeRedirect } from '~/utils/auth-session'
definePageMeta({ layout: 'minimal' })
const route = useRoute()
await navigateTo({ path: '/login', query: { redirect: safeRedirect(route.query.redirect) } }, { replace: true })
</script>
