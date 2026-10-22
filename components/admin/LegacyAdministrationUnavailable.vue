<template>
  <div class="p-4 sm:p-6">
    <section class="max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 dark:border-white/10 dark:bg-white/5" aria-labelledby="administration-title">
      <h1 id="administration-title" class="text-xl font-bold text-gray-900 dark:text-white">{{ copy.title }}</h1>
      <p class="mt-3 leading-relaxed text-gray-600 dark:text-gray-300">{{ copy.description }}</p>
      <NuxtLink to="/settings/organization" class="mt-6 inline-flex items-center justify-center rounded-xl bg-primary-main px-5 py-3 font-medium text-white transition hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-main">
        {{ copy.link }}
      </NuxtLink>
    </section>
  </div>
</template>

<script setup lang="ts">
const { locale } = useI18n()
const copy = computed(() => String(locale.value).startsWith('ko') ? {
  title: '회사 관리',
  description: '전체 사용자·회사 관리 페이지는 현재 제공되지 않아요. 소속 회사의 정보와 멤버는 회사 설정에서 관리할 수 있어요.',
  link: '회사 설정 열기'
} : {
  title: '会社の管理',
  description: '全ユーザー・全会社の管理ページは現在ご利用いただけません。所属する会社の情報やメンバーは、会社設定から管理できます。',
  link: '会社設定を開く'
})
</script>
