<template>
 <span class="navi-avatar" :class="{ 'navi-avatar-small': size === 'sm', 'navi-avatar-launcher': size === 'launcher' }" aria-hidden="true">
  <img src="/images/omf-navi-film.jpg" alt="" width="1280" height="720" loading="lazy" decoding="async">
 </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'launcher' }>(), { size: 'md' })
</script>

<style scoped>
.navi-avatar { position:relative;display:inline-block;flex-shrink:0;width:2.75rem;height:2.75rem;overflow:hidden;border-radius:50%;background:#faf8f3;box-shadow:0 0 0 1px rgb(147 64 43 / 12%); }
/* The original introduction-film frame stays intact; this viewport frames her face. */
.navi-avatar img { position:absolute;width:500%;max-width:none;height:auto;left:-239%;top:-62%; }
.navi-avatar-small { width:1.5rem;height:1.5rem; }
.navi-avatar-launcher { width:var(--navi-launcher-size,4rem);height:var(--navi-launcher-size,4rem);box-shadow:0 0 0 2px white,0 0 0 3px rgb(147 64 43 / 18%); }
</style>
