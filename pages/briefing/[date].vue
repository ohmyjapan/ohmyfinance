<template>
  <div>
    <!-- Back navigation -->
    <div class="mb-4">
      <NuxtLink
        to="/briefing"
        class="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-main dark:hover:text-primary-main"
      >
        <ArrowLeft class="h-4 w-4" />
        {{ t('briefing.backToList') }}
      </NuxtLink>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !currentBriefing && dateBriefings.length === 0" class="flex justify-center items-center py-20">
      <Loader class="h-8 w-8 text-primary-main animate-spin" />
      <span class="ml-3 text-gray-600 dark:text-gray-400">{{ t('common.loading') }}</span>
    </div>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--   Single Briefing Detail (when param is MongoDB ObjectId)  -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <div v-else-if="isSingleBriefing && currentBriefing">
      <SingleBriefingDetail :briefing="currentBriefing" />
    </div>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--   Date-based Briefing List (when param is YYYY-MM-DD)      -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <div v-else-if="!isSingleBriefing">
      <!-- Date header -->
      <header class="mb-6">
        <div class="flex items-center gap-3">
          <Calendar class="h-6 w-6 text-primary-main dark:text-primary-light" />
          <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">
            {{ formatPageDate(dateParam) }}
          </h1>
          <span class="text-sm text-gray-400 dark:text-gray-500">
            ({{ dateBriefings.length }} {{ t('briefing.stocksCount') }})
          </span>
        </div>
        <p class="mt-1 text-gray-600 dark:text-gray-400">{{ t('briefing.dailySummary') }}</p>
      </header>

      <!-- Empty state for date -->
      <div v-if="!isLoading && dateBriefings.length === 0" class="text-center py-16">
        <Newspaper class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
        <h3 class="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">{{ t('briefing.noDateBriefings') }}</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('briefing.noDateBriefingsDesc') }}</p>
      </div>

      <!-- Briefing cards for this date -->
      <div v-else class="space-y-6">
        <div
          v-for="briefing in dateBriefings"
          :key="briefing.id"
          class="bg-white dark:bg-white/5 rounded-xl shadow-sm border border-gray-200 dark:border-white/10 overflow-hidden"
        >
          <SingleBriefingDetail :briefing="briefing" :collapsible="true" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center py-16">
      <AlertCircle class="mx-auto h-12 w-12 text-red-400" />
      <h3 class="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">{{ t('common.error') }}</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ error }}</p>
      <NuxtLink
        to="/briefing"
        class="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-primary-main hover:text-primary-dark"
      >
        {{ t('briefing.backToList') }}
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h as createElement } from 'vue'
import {
  ArrowLeft,
  Loader,
  Calendar,
  Newspaper,
  AlertCircle,
  Bookmark,
  Shield,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Trash2,
  Database,
  CheckCircle,
  XCircle
} from 'lucide-vue-next'
import type { StockBriefing } from '~/composables/useBriefing'

const { t } = useI18n()
const route = useRoute()
const {
  briefings,
  currentBriefing,
  isLoading,
  error,
  fetchBriefings,
  fetchBriefingById,
  toggleBookmark,
  updateNotes,
  deleteBriefing,
  formatPrice,
  formatPercent,
  formatVolume,
  formatMarketCap,
  formatDate,
  formatDateTime,
  getSentimentColor,
  getSentimentBg
} = useBriefing()

const dateParam = computed(() => route.params.date as string)

// Determine if param is a MongoDB ObjectId or a date string
const isSingleBriefing = computed(() => {
  return /^[0-9a-fA-F]{24}$/.test(dateParam.value)
})

const dateBriefings = ref<StockBriefing[]>([])

const formatPageDate = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
}

onMounted(async () => {
  if (isSingleBriefing.value) {
    await fetchBriefingById(dateParam.value)
  } else {
    // Fetch briefings for this date
    await fetchBriefings({
      limit: 50,
      offset: 0,
      filters: {
        dateFrom: dateParam.value,
        dateTo: dateParam.value
      }
    })
    dateBriefings.value = briefings.value
  }
})

// ─── Single Briefing Detail Sub-component ────────────────────────

const SingleBriefingDetail = defineComponent({
  props: {
    briefing: { type: Object as () => StockBriefing, required: true },
    collapsible: { type: Boolean, default: false }
  },
  setup(props) {
    const expanded = ref(!props.collapsible)
    const showNotes = ref(false)
    const notesInput = ref(props.briefing.userNotes || '')
    const showDataSources = ref(false)

    const toggleExpand = () => {
      if (props.collapsible) expanded.value = !expanded.value
    }

    const handleBookmark = async () => {
      await toggleBookmark(props.briefing.id)
    }

    const handleSaveNotes = async () => {
      await updateNotes(props.briefing.id, notesInput.value)
      showNotes.value = false
    }

    const handleDelete = async () => {
      if (confirm(t('briefing.confirmDelete'))) {
        await deleteBriefing(props.briefing.id)
        navigateTo('/briefing')
      }
    }

    const priceData = computed(() => props.briefing.priceData)
    const isPositive = computed(() => priceData.value.change >= 0)

    return () => {
      const b = props.briefing
      const pd = priceData.value

      return createElement('div', { class: 'divide-y divide-gray-100 dark:divide-white/10' }, [
        // ─── Header Section ──────────────────────
        createElement('div', {
          class: ['px-6 py-5', props.collapsible ? 'cursor-pointer' : ''].filter(Boolean).join(' '),
          onClick: toggleExpand
        }, [
          createElement('div', { class: 'flex items-start justify-between' }, [
            // Left: ticker + company
            createElement('div', {}, [
              createElement('div', { class: 'flex items-center gap-3' }, [
                createElement('h1', { class: 'text-2xl font-bold text-gray-900 dark:text-gray-100' }, b.ticker),
                createElement('span', {
                  class: `px-2.5 py-0.5 rounded-full text-xs font-semibold ${getSentimentBg(b.overallSentiment)} ${getSentimentColor(b.overallSentiment)}`
                }, t(`briefing.sentiment.${b.overallSentiment}`)),
                createElement('span', {
                  class: `px-2 py-0.5 rounded text-xs font-medium ${
                    b.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    b.status === 'generating' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                    'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                  }`
                }, t(`briefing.status${b.status.charAt(0).toUpperCase() + b.status.slice(1)}`))
              ]),
              createElement('p', { class: 'mt-1 text-sm text-gray-500 dark:text-gray-400' }, [
                b.companyName,
                b.sector ? ` · ${b.sector}` : '',
                b.industry ? ` · ${b.industry}` : '',
                b.exchange ? ` · ${b.exchange}` : ''
              ].join(''))
            ]),
            // Right: actions
            createElement('div', { class: 'flex items-center gap-2' }, [
              // Bookmark
              createElement('button', {
                class: `p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.07] ${b.isBookmarked ? 'text-yellow-500' : 'text-gray-400'}`,
                onClick: (e: Event) => { e.stopPropagation(); handleBookmark() }
              }, [createElement(Bookmark, { class: 'h-5 w-5', fill: b.isBookmarked ? 'currentColor' : 'none' })]),
              // Notes
              createElement('button', {
                class: 'p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.07] text-gray-400',
                onClick: (e: Event) => { e.stopPropagation(); showNotes.value = !showNotes.value }
              }, [createElement(MessageSquare, { class: 'h-5 w-5' })]),
              // Delete
              createElement('button', {
                class: 'p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500',
                onClick: (e: Event) => { e.stopPropagation(); handleDelete() }
              }, [createElement(Trash2, { class: 'h-5 w-5' })]),
              // Collapse toggle
              props.collapsible
                ? createElement('button', {
                    class: 'p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.07] text-gray-400'
                  }, [createElement(expanded.value ? ChevronUp : ChevronDown, { class: 'h-5 w-5' })])
                : null
            ].filter(Boolean))
          ]),

          // Price data
          createElement('div', { class: 'mt-4 flex items-end gap-4 flex-wrap' }, [
            createElement('span', { class: 'text-3xl font-bold text-gray-900 dark:text-gray-100' },
              formatPrice(pd.current, pd.currency)
            ),
            createElement('span', {
              class: `text-lg font-semibold ${isPositive.value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`
            }, `${pd.change >= 0 ? '+' : ''}${pd.change.toFixed(2)} (${formatPercent(pd.changePercent)})`),
            createElement('div', { class: 'flex gap-4 ml-auto text-xs text-gray-500 dark:text-gray-400' }, [
              createElement('span', {}, `Open: $${pd.open.toFixed(2)}`),
              createElement('span', {}, `Vol: ${formatVolume(pd.volume)}`),
              pd.marketCap ? createElement('span', {}, `MCap: ${formatMarketCap(pd.marketCap)}`) : null,
            ].filter(Boolean))
          ]),

          // User notes input
          showNotes.value
            ? createElement('div', {
                class: 'mt-4 p-3 bg-gray-50 dark:bg-white/5 rounded-lg',
                onClick: (e: Event) => e.stopPropagation()
              }, [
                createElement('textarea', {
                  class: 'w-full p-2 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl text-sm resize-none focus:ring-primary-main focus:border-primary-main',
                  rows: 3,
                  placeholder: t('briefing.notesPlaceholder'),
                  value: notesInput.value,
                  onInput: (e: Event) => { notesInput.value = (e.target as HTMLTextAreaElement).value }
                }),
                createElement('div', { class: 'mt-2 flex justify-end gap-2' }, [
                  createElement('button', {
                    class: 'px-3 py-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800',
                    onClick: () => { showNotes.value = false }
                  }, t('common.cancel')),
                  createElement('button', {
                    class: 'px-3 py-1 text-sm font-medium text-white bg-primary-main rounded hover:bg-primary-dark',
                    onClick: handleSaveNotes
                  }, t('common.save'))
                ])
              ])
            : null
        ].filter(Boolean)),

        // ─── Expandable Content ──────────────────
        expanded.value ? createElement('div', {}, [
          // Executive Summary
          b.executiveSummary
            ? createElement('div', { class: 'px-6 py-4 bg-primary-main/10 dark:bg-primary-main/20/10 border-b border-gray-100 dark:border-white/10' }, [
                createElement('h3', { class: 'text-sm font-semibold text-primary-dark dark:text-primary-light uppercase mb-2' }, t('briefing.executiveSummary')),
                createElement('p', { class: 'text-sm text-gray-700 dark:text-gray-300 leading-relaxed' }, b.executiveSummary)
              ])
            : null,

          // Primary Movers
          b.primaryMovers && b.primaryMovers.length > 0
            ? createElement('div', { class: 'px-6 py-4 border-b border-gray-100 dark:border-white/10' }, [
                createElement('h3', { class: 'text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase mb-3' }, t('briefing.whyItMoved')),
                createElement('div', { class: 'space-y-2' },
                  b.primaryMovers.map((m, i) =>
                    createElement('div', { key: i, class: 'flex items-start gap-3' }, [
                      createElement('span', {
                        class: 'flex-shrink-0 w-6 h-6 rounded-full bg-primary-main/20 dark:bg-primary-main/20 text-primary-main dark:text-primary-light text-sm font-bold flex items-center justify-center'
                      }, String(i + 1)),
                      createElement('p', { class: 'text-sm text-gray-700 dark:text-gray-300' }, m)
                    ])
                  )
                )
              ])
            : null,

          // Events Timeline
          b.events && b.events.length > 0
            ? createElement('div', { class: 'px-6 py-4 border-b border-gray-100 dark:border-white/10' }, [
                createElement('h3', { class: 'text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase mb-3' },
                  `${t('briefing.keyEvents')} (${b.events.length})`
                ),
                createElement(resolveComponent('EventTimeline'), { events: b.events })
              ])
            : null,

          // Financial Highlights
          (b.financialHighlights && b.financialHighlights.length > 0) || (b.guidance && b.guidance.length > 0)
            ? createElement('div', { class: 'px-6 py-4 border-b border-gray-100 dark:border-white/10' }, [
                createElement('h3', { class: 'text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase mb-3' }, t('briefing.financials')),
                createElement(resolveComponent('FinancialHighlight'), {
                  highlights: b.financialHighlights || [],
                  guidance: b.guidance || [],
                  analystInfo: b.analystInfo
                })
              ])
            : null,

          // AI Sections
          b.sections && b.sections.length > 0
            ? createElement('div', { class: 'px-6 py-4 border-b border-gray-100 dark:border-white/10' }, [
                createElement('h3', { class: 'text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase mb-3' }, t('briefing.analysis')),
                createElement('div', { class: 'space-y-4' },
                  b.sections.map((s, i) =>
                    createElement('div', {
                      key: i,
                      class: `p-4 rounded-lg border ${
                        s.importance === 'critical' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10' :
                        s.importance === 'high' ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10' :
                        'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5'
                      }`
                    }, [
                      createElement('div', { class: 'flex items-center gap-2 mb-2' }, [
                        createElement('h4', { class: 'text-sm font-semibold text-gray-800 dark:text-gray-100' }, s.title),
                        createElement('span', {
                          class: `px-1.5 py-0.5 rounded text-xs font-medium ${
                            s.importance === 'critical' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' :
                            s.importance === 'high' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' :
                            s.importance === 'medium' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                            'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300'
                          }`
                        }, s.importance)
                      ]),
                      createElement('p', { class: 'text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line' }, s.content)
                    ])
                  )
                )
              ])
            : null,

          // Tags
          b.tags && b.tags.length > 0
            ? createElement('div', { class: 'px-6 py-3 border-b border-gray-100 dark:border-white/10' }, [
                createElement('div', { class: 'flex flex-wrap gap-1.5' },
                  b.tags.map((tag, i) =>
                    createElement('span', {
                      key: i,
                      class: 'px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300'
                    }, `#${tag}`)
                  )
                )
              ])
            : null,

          // Data Sources
          createElement('div', { class: 'px-6 py-3' }, [
            createElement('button', {
              class: 'flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600',
              onClick: () => { showDataSources.value = !showDataSources.value }
            }, [
              createElement(Database, { class: 'h-3.5 w-3.5' }),
              createElement('span', {},
                `${t('briefing.dataSources')} (${b.dataSources?.length || 0})`
              ),
              createElement(showDataSources.value ? ChevronUp : ChevronDown, { class: 'h-3 w-3' })
            ]),
            showDataSources.value && b.dataSources?.length
              ? createElement('div', { class: 'mt-2 space-y-1' },
                  b.dataSources.map((ds, i) =>
                    createElement('div', {
                      key: i,
                      class: 'flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'
                    }, [
                      createElement(ds.success ? CheckCircle : XCircle, {
                        class: `h-3.5 w-3.5 ${ds.success ? 'text-green-500' : 'text-red-500'}`
                      }),
                      createElement('span', { class: 'font-medium' }, ds.name),
                      createElement('span', {}, `${ds.dataPoints} points`),
                      ds.error ? createElement('span', { class: 'text-red-400' }, ds.error) : null
                    ].filter(Boolean))
                  )
                )
              : null,
            // Generation time
            createElement('div', { class: 'mt-2 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500' }, [
              createElement(Clock, { class: 'h-3 w-3' }),
              createElement('span', {}, `${t('briefing.generatedAt')}: ${formatDateTime(b.generatedAt)}`)
            ])
          ])
        ].filter(Boolean)) : null
      ])
    }
  }
})
</script>
