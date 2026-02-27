<template>
  <div class="space-y-3">
    <div
      v-for="(event, index) in events"
      :key="index"
      class="relative pl-8"
    >
      <!-- Timeline line -->
      <div
        v-if="index < events.length - 1"
        class="absolute left-3 top-8 w-0.5 h-full -ml-px bg-gray-200 dark:bg-gray-700"
      ></div>

      <!-- Timeline dot -->
      <div
        class="absolute left-0 top-1 flex items-center justify-center w-6 h-6 rounded-full border-2"
        :class="dotClass(event.impact)"
      >
        <component
          :is="icons[getEventTypeIcon(event.type)]"
          class="h-3 w-3"
        />
      </div>

      <!-- Event content -->
      <div
        class="p-3 rounded-lg border transition-colors"
        :class="getImpactBg(event.impact)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <!-- Type badge + Title -->
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                :class="typeBadgeClass(event.type)"
              >
                {{ t(`briefing.eventTypes.${event.type}`) }}
              </span>
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {{ event.title }}
              </h4>
            </div>

            <!-- Description -->
            <p class="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-3">
              {{ event.description }}
            </p>

            <!-- Source + Date -->
            <div class="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1">
                <Globe class="h-3 w-3" />
                <a
                  v-if="event.sourceUrl"
                  :href="event.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-purple-600 dark:hover:text-purple-400 underline"
                >{{ event.source }}</a>
                <span v-else>{{ event.source }}</span>
              </span>
              <span class="flex items-center gap-1">
                <Clock class="h-3 w-3" />
                {{ formatEventDate(event.date) }}
              </span>
            </div>
          </div>

          <!-- Impact score badge -->
          <div class="flex-shrink-0">
            <div
              class="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold"
              :class="impactScoreClass(event.impactScore)"
            >
              <component
                :is="event.impactScore > 0 ? icons.TrendingUp : event.impactScore < 0 ? icons.TrendingDown : icons.Minus"
                class="h-3 w-3"
              />
              {{ event.impactScore > 0 ? '+' : '' }}{{ event.impactScore }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!events || events.length === 0" class="text-center py-8">
      <Calendar class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('briefing.noEvents') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Globe,
  Clock,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Shield,
  GitMerge,
  FileText,
  Target,
  Scale,
  UserCheck,
  DollarSign,
  FileCheck,
  Info
} from 'lucide-vue-next'
import type { BriefingEvent } from '~/composables/useBriefing'

defineProps<{
  events: BriefingEvent[]
}>()

const { t } = useI18n()
const { getEventTypeIcon, getImpactBg } = useBriefing()

const icons: Record<string, any> = {
  BarChart3, Shield, GitMerge, FileText, Target, Scale,
  UserCheck, TrendingUp, DollarSign, FileCheck, Info,
  TrendingDown, Minus
}

const dotClass = (impact: string) => {
  switch (impact) {
    case 'positive': return 'bg-green-100 dark:bg-green-900/50 border-green-500 text-green-600 dark:text-green-400'
    case 'negative': return 'bg-red-100 dark:bg-red-900/50 border-red-500 text-red-600 dark:text-red-400'
    case 'mixed': return 'bg-yellow-100 dark:bg-yellow-900/50 border-yellow-500 text-yellow-600 dark:text-yellow-400'
    default: return 'bg-gray-100 dark:bg-gray-700 border-gray-400 text-gray-500 dark:text-gray-400'
  }
}

const typeBadgeClass = (type: string) => {
  const map: Record<string, string> = {
    earnings: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    fda: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    merger: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    contract: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
    guidance: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    regulatory: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    insider: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
    analyst: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',
    dividend: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
    sec_filing: 'bg-slate-100 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300'
  }
  return map[type] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
}

const impactScoreClass = (score: number) => {
  if (score >= 3) return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
  if (score >= 1) return 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
  if (score <= -3) return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
  if (score <= -1) return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
}

const formatEventDate = (isoDate: string) => {
  return new Date(isoDate).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>
