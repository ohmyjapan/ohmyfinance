<template>
  <div class="p-6 pb-24">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('organization.settings') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('organization.manageOrganization') }}</p>
    </div>

    <!-- No Organization - Show Create Form -->
    <div v-if="!currentOrganization" class="space-y-6">
      <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
        <p class="text-yellow-800 dark:text-yellow-200">{{ t('organizationPage.noOrganization') }}</p>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('organizationPage.createNew') }}</h2>
        <p class="text-gray-600 dark:text-gray-400 mb-6">{{ t('organizationPage.createNewDesc') }}</p>

        <form @submit.prevent="createOrganization" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('organizationPage.name') }} <span class="text-red-500">*</span>
              </label>
              <input
                v-model="createForm.name"
                type="text"
                required
                :placeholder="t('organization.namePlaceholder')"
                class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.type') }}</label>
              <select
                v-model="createForm.type"
                class="mt-1 block w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 sm:text-sm cursor-pointer"
              >
                <option value="personal" class="bg-white dark:bg-gray-700">{{ t('organization.types.personal') }}</option>
                <option value="business" class="bg-white dark:bg-gray-700">{{ t('organization.types.business') }}</option>
                <option value="enterprise" class="bg-white dark:bg-gray-700">{{ t('organization.types.enterprise') }}</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.email') }}</label>
              <input
                v-model="createForm.email"
                type="email"
                class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.phone') }}</label>
              <input
                v-model="createForm.phone"
                type="tel"
                class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.website') }}</label>
              <input
                v-model="createForm.website"
                type="url"
                placeholder="https://"
                class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.taxId') }}</label>
              <input
                v-model="createForm.taxId"
                type="text"
                class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.description') }}</label>
              <textarea
                v-model="createForm.description"
                rows="3"
                :placeholder="t('organization.descriptionPlaceholder')"
                class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              ></textarea>
            </div>
          </div>

          <div v-if="createError" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p class="text-sm text-red-600 dark:text-red-400">{{ createError }}</p>
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="creating || !createForm.name"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span v-if="creating" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
              {{ t('organization.create') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-else class="space-y-6">
      <!-- Organization Details -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('organizationPage.organizationDetails') }}</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.name') }}</label>
            <input
              v-model="orgForm.name"
              type="text"
              :disabled="!canEdit"
              @input="markDirty"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.type') }}</label>
            <select
              v-model="orgForm.type"
              :disabled="!canEdit"
              @change="markDirty"
              class="mt-1 block w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 sm:text-sm cursor-pointer disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
            >
              <option value="personal" class="bg-white dark:bg-gray-700">{{ t('organization.types.personal') }}</option>
              <option value="business" class="bg-white dark:bg-gray-700">{{ t('organization.types.business') }}</option>
              <option value="enterprise" class="bg-white dark:bg-gray-700">{{ t('organization.types.enterprise') }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.email') }}</label>
            <input
              v-model="orgForm.email"
              type="email"
              :disabled="!canEdit"
              @input="markDirty"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.phone') }}</label>
            <input
              v-model="orgForm.phone"
              type="tel"
              :disabled="!canEdit"
              @input="markDirty"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.website') }}</label>
            <input
              v-model="orgForm.website"
              type="url"
              :disabled="!canEdit"
              @input="markDirty"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.taxId') }}</label>
            <input
              v-model="orgForm.taxId"
              type="text"
              :disabled="!canEdit"
              @input="markDirty"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            />
          </div>

          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.description') }}</label>
            <textarea
              v-model="orgForm.description"
              rows="2"
              :disabled="!canEdit"
              @input="markDirty"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- Settings -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('organizationPage.settings') }}</h2>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.defaultCurrency') }}</label>
            <select
              v-model="settingsForm.defaultCurrency"
              :disabled="!canEdit"
              @change="markDirty"
              class="mt-1 block w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            >
              <option value="JPY">JPY - {{ t('currencies.jpy') }}</option>
              <option value="USD">USD - {{ t('currencies.usd') }}</option>
              <option value="EUR">EUR - {{ t('currencies.eur') }}</option>
              <option value="GBP">GBP - {{ t('currencies.gbp') }}</option>
              <option value="CNY">CNY - 中国元</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.timezone') }}</label>
            <select
              v-model="settingsForm.timezone"
              :disabled="!canEdit"
              @change="markDirty"
              class="mt-1 block w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            >
              <option value="Asia/Tokyo">Asia/Tokyo</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Paris">Europe/Paris</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.fiscalYearStart') }}</label>
            <select
              v-model="settingsForm.fiscalYearStart"
              :disabled="!canEdit"
              @change="markDirty"
              class="mt-1 block w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800"
            >
              <option v-for="month in 12" :key="month" :value="month">{{ t(`organizationPage.months.${month}`) }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Team Members -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('organizationPage.teamMembers') }}</h2>
          <button
            v-if="canInvite"
            @click="showInviteModal = true"
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            {{ t('organizationPage.inviteMember') }}
          </button>
        </div>

        <div v-if="loadingMembers" class="text-center py-4">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead>
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('organizationPage.member') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('organizationPage.role') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('organizationPage.joined') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('organizationPage.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="member in members" :key="member.userId">
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex items-center">
                    <div class="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-sm font-medium">
                      {{ member.user?.name?.charAt(0) || '?' }}
                    </div>
                    <div class="ml-3">
                      <div class="text-sm font-medium text-gray-900 dark:text-white">{{ member.user?.name || t('common.unknown') }}</div>
                      <div class="text-sm text-gray-500 dark:text-gray-400">{{ member.user?.email || '' }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span :class="getRoleBadgeClass(member.role)" class="px-2 py-1 text-xs rounded-full">
                    {{ member.role }}
                  </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {{ formatDate(member.joinedAt) }}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm">
                  <div v-if="canManageMember(member)" class="flex gap-2">
                    <select
                      v-if="member.role !== 'owner'"
                      :value="member.role"
                      @change="updateMemberRole(member.userId, ($event.target as HTMLSelectElement).value)"
                      class="text-xs rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      v-if="member.role !== 'owner'"
                      @click="removeMember(member.userId)"
                      class="text-red-600 hover:text-red-800"
                    >
                      {{ t('organizationPage.remove') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Switch Organization -->
      <div v-if="organizations.length > 1" class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('organizationPage.switchOrganization') }}</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            v-for="org in organizations"
            :key="org.id"
            @click="handleSwitchOrg(org.id)"
            :class="[
              'p-4 rounded-lg border-2 text-left transition-colors',
              org.id === currentOrganization?.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            ]"
          >
            <div class="font-medium text-gray-900 dark:text-white">{{ org.name }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400 capitalize">{{ org.type }}</div>
            <div class="text-xs text-gray-400 mt-1">{{ t('organizationPage.role') }}: {{ org.role }}</div>
          </button>
        </div>
      </div>
    </div>

    <!-- Floating Save Button -->
    <Transition name="slide-up">
      <div
        v-if="isDirty && canEdit && currentOrganization"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
      >
        <div class="bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center gap-4">
          <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('common.unsavedChanges') }}</span>
          <button
            @click="discardChanges"
            class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            {{ t('common.discard') }}
          </button>
          <button
            @click="saveAllChanges"
            :disabled="saving"
            class="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            <Save v-if="!saving" class="w-4 h-4" />
            <span v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
            {{ saving ? t('organizationPage.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Invite Modal -->
    <div v-if="showInviteModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('organizationPage.inviteTeamMember') }}</h3>

        <form @submit.prevent="sendInvite" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.emailAddress') }}</label>
            <input
              v-model="inviteForm.email"
              type="email"
              required
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              :placeholder="t('organizationPage.emailPlaceholder')"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('organizationPage.role') }}</label>
            <select
              v-model="inviteForm.role"
              class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          <div v-if="inviteResult" class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-3">
            <p class="text-sm text-green-800 dark:text-green-200">{{ inviteResult }}</p>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button
              type="button"
              @click="showInviteModal = false"
              class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="inviting"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {{ inviting ? t('organizationPage.sending') : t('organizationPage.sendInvite') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Save } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()

const userStore = useUserStore()

// Get auth header for API calls
const getAuthHeader = () => userStore.authHeader

// Placeholder for organization data (we'll fetch it)
const currentOrganization = ref<any>(null)
const organizations = ref<any[]>([])

const loading = ref(false)
const saving = ref(false)
const loadingMembers = ref(false)
const members = ref<any[]>([])
const showInviteModal = ref(false)
const inviting = ref(false)
const inviteResult = ref('')
const creating = ref(false)
const createError = ref('')
const isDirty = ref(false)

const createForm = ref({
  name: '',
  type: 'personal',
  email: '',
  phone: '',
  website: '',
  taxId: '',
  description: ''
})

const orgForm = ref({
  name: '',
  type: 'personal',
  email: '',
  phone: '',
  website: '',
  taxId: '',
  description: ''
})

const settingsForm = ref({
  defaultCurrency: 'JPY',
  timezone: 'Asia/Tokyo',
  fiscalYearStart: 4
})

const inviteForm = ref({
  email: '',
  role: 'member' as 'admin' | 'member' | 'viewer'
})

const canEdit = computed(() => {
  return currentOrganization.value?.role === 'owner' || currentOrganization.value?.role === 'admin'
})

const canInvite = computed(() => {
  return currentOrganization.value?.role === 'owner' || currentOrganization.value?.role === 'admin'
})

const canManageMember = (member: any) => {
  if (!canEdit.value) return false
  if (member.role === 'owner') return false
  if (currentOrganization.value?.role === 'admin' && member.role === 'admin') return false
  return true
}

onMounted(async () => {
  // Initialize auth if not done
  if (!userStore.isAuthenticated) {
    userStore.initAuth()
  }

  // Fetch user's organizations
  await fetchOrganizations()

  if (currentOrganization.value) {
    loadOrgData()
    loadMembers()
  }
})

async function fetchOrganizations() {
  try {
    const response = await $fetch<any>('/api/organizations', {
      headers: getAuthHeader()
    })
    if (response.success) {
      organizations.value = response.organizations
      // Set current organization to the first one if available
      if (response.organizations.length > 0) {
        currentOrganization.value = response.organizations[0]
      }
    }
  } catch (error) {
    console.error('Failed to fetch organizations:', error)
  }
}

watch(currentOrganization, (newVal) => {
  if (newVal) {
    loadOrgData()
    loadMembers()
  }
})

function loadOrgData() {
  if (!currentOrganization.value) return

  orgForm.value = {
    name: currentOrganization.value.name || '',
    type: currentOrganization.value.type || 'personal',
    email: (currentOrganization.value as any).email || '',
    phone: (currentOrganization.value as any).phone || '',
    website: (currentOrganization.value as any).website || '',
    taxId: (currentOrganization.value as any).taxId || '',
    description: (currentOrganization.value as any).description || ''
  }

  settingsForm.value = {
    defaultCurrency: currentOrganization.value.settings?.defaultCurrency || 'JPY',
    timezone: currentOrganization.value.settings?.timezone || 'Asia/Tokyo',
    fiscalYearStart: currentOrganization.value.settings?.fiscalYearStart || 4
  }

  isDirty.value = false
}

function markDirty() {
  isDirty.value = true
}

function discardChanges() {
  loadOrgData()
  isDirty.value = false
}

async function saveAllChanges() {
  if (!currentOrganization.value) return

  saving.value = true
  try {
    const orgId = currentOrganization.value.id || currentOrganization.value._id
    const response = await fetch(`/api/organizations/${orgId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        ...orgForm.value,
        settings: settingsForm.value
      })
    })
    const data = await response.json()
    if (data.success) {
      isDirty.value = false
      // Update local state
      currentOrganization.value = { ...currentOrganization.value, ...data.organization }
    } else {
      alert(data.statusMessage || t('common.error'))
    }
  } catch (error) {
    console.error('Failed to save:', error)
    alert(t('common.error'))
  } finally {
    saving.value = false
  }
}

async function loadMembers() {
  if (!currentOrganization.value) return

  loadingMembers.value = true
  try {
    const orgId = currentOrganization.value.id || currentOrganization.value._id
    const response = await fetch(`/api/organizations/${orgId}/members`, {
      headers: getAuthHeader()
    })
    const data = await response.json()
    if (data.success) {
      members.value = data.members
    }
  } catch (error) {
    console.error('Failed to load members:', error)
  } finally {
    loadingMembers.value = false
  }
}


async function updateMemberRole(userId: string, role: string) {
  if (!currentOrganization.value) return

  try {
    const orgId = currentOrganization.value.id || currentOrganization.value._id
    const response = await fetch(`/api/organizations/${orgId}/members`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ userId, role })
    })
    const data = await response.json()
    if (data.success) {
      await loadMembers()
    }
  } catch (error) {
    console.error('Failed to update member role:', error)
    alert(t('common.error'))
  }
}

async function removeMember(userId: string) {
  if (!confirm(t('common.confirmDelete'))) return
  if (!currentOrganization.value) return

  try {
    const orgId = currentOrganization.value.id || currentOrganization.value._id
    const response = await fetch(`/api/organizations/${orgId}/members`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ userId })
    })
    const data = await response.json()
    if (data.success) {
      await loadMembers()
    }
  } catch (error) {
    console.error('Failed to remove member:', error)
    alert(t('common.error'))
  }
}

async function sendInvite() {
  if (!currentOrganization.value) return

  inviting.value = true
  inviteResult.value = ''
  try {
    const orgId = currentOrganization.value.id || currentOrganization.value._id
    const response = await fetch(`/api/organizations/${orgId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(inviteForm.value)
    })
    const data = await response.json()
    if (data.success) {
      inviteResult.value = data.message
      inviteForm.value = { email: '', role: 'member' }
    } else {
      alert(data.statusMessage || t('common.error'))
    }
  } catch (error) {
    console.error('Failed to send invite:', error)
    alert(t('common.error'))
  } finally {
    inviting.value = false
  }
}

async function switchOrganization(orgId: string): Promise<boolean> {
  try {
    const org = organizations.value.find(o => (o.id || o._id) === orgId)
    if (org) {
      currentOrganization.value = org
      return true
    }
    return false
  } catch (error) {
    console.error('Failed to switch organization:', error)
    return false
  }
}

async function handleSwitchOrg(orgId: string) {
  if (orgId === currentOrganization.value?.id) return

  const success = await switchOrganization(orgId)
  if (success) {
    loadOrgData()
    loadMembers()
  }
}

function getRoleBadgeClass(role: string) {
  const classes: Record<string, string> = {
    owner: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    member: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
  }
  return classes[role] || classes.viewer
}

function formatDate(date: string) {
  if (!date) return ''
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(date).toLocaleDateString(dateLocale)
}

async function createOrganization() {
  if (!createForm.value.name) return

  creating.value = true
  createError.value = ''

  try {
    const response = await $fetch<any>('/api/organizations', {
      method: 'POST',
      headers: getAuthHeader(),
      body: {
        name: createForm.value.name,
        type: createForm.value.type,
        description: createForm.value.description,
        email: createForm.value.email,
        phone: createForm.value.phone,
        website: createForm.value.website,
        taxId: createForm.value.taxId
      }
    })

    if (response.success) {
      // Refresh the page to load the new organization
      window.location.reload()
    }
  } catch (err: any) {
    createError.value = err.data?.statusMessage || t('common.error')
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 100%);
}
</style>
