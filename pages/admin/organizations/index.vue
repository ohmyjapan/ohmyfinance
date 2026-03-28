<template>
  <div class="p-6">
    <div class="mb-6 flex justify-between items-start">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('admin.organizationManagement') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('admin.manageOrganizations') }}</p>
      </div>
      <button
        @click="showCreateModal = true"
        class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('admin.createOrganization') }}
      </button>
    </div>

    <!-- Search -->
    <div class="mb-6 flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('common.search')"
          class="w-full px-4 py-2 border border-gray-300 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-white/5 dark:text-white"
          @input="debouncedSearch"
        />
      </div>
    </div>

    <!-- Organizations grid -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <svg class="animate-spin h-8 w-8 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>

    <div v-else-if="organizations.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400">
      {{ t('admin.noOrganizationsFound') }}
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="org in organizations"
        :key="org.id"
        class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-6 hover:shadow-lg transition-shadow"
      >
        <div class="flex justify-between items-start mb-4">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ org.name }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ org.slug }}</p>
          </div>
          <span
            :class="org.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'"
            class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
          >
            {{ org.isActive ? t('admin.active') : t('admin.inactive') }}
          </span>
        </div>

        <div class="mb-4">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-white/5 text-gray-800 dark:text-gray-200">
            {{ org.type === 'business' ? t('organization.business') : t('organization.personal') }}
          </span>
        </div>

        <div class="mb-4">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">{{ t('admin.members') }} ({{ org.members?.length || 0 }})</p>
          <div class="flex -space-x-2">
            <div
              v-for="(member, index) in (org.members || []).slice(0, 5)"
              :key="member.userId"
              class="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center border-2 border-white dark:border-gray-800"
              :title="member.name"
            >
              <span class="text-red-600 dark:text-red-400 text-xs font-medium">{{ member.name?.charAt(0)?.toUpperCase() }}</span>
            </div>
            <div
              v-if="(org.members?.length || 0) > 5"
              class="h-8 w-8 rounded-full bg-gray-200 dark:bg-white/5 flex items-center justify-center border-2 border-white dark:border-gray-800"
            >
              <span class="text-gray-600 dark:text-gray-400 text-xs">+{{ org.members.length - 5 }}</span>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-white/10">
          <button
            @click="manageMembers(org)"
            class="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            {{ t('admin.members') }}
          </button>
          <button
            @click="editOrg(org)"
            class="px-3 py-1 text-sm text-red-600 hover:text-red-700 dark:text-red-400"
          >
            {{ t('common.edit') }}
          </button>
          <button
            @click="confirmDelete(org)"
            class="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create Organization Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black opacity-50" @click="showCreateModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl shadow-xl max-w-md w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">{{ t('admin.createOrganization') }}</h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.name') }}</label>
              <input
                v-model="newOrg.name"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white"
                :placeholder="t('organization.namePlaceholder')"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.type') }}</label>
              <select
                v-model="newOrg.type"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white"
              >
                <option value="personal">{{ t('organization.personal') }}</option>
                <option value="business">{{ t('organization.business') }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('admin.owner') }} ({{ t('common.optional') }})</label>
              <select
                v-model="newOrg.ownerId"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white"
              >
                <option value="">{{ t('admin.noOwner') }}</option>
                <option v-for="user in allUsers" :key="user.id" :value="user.id">
                  {{ user.name }} ({{ user.email }})
                </option>
              </select>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button
              @click="showCreateModal = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-lg"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="createOrg"
              :disabled="!newOrg.name"
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {{ t('common.create') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Organization Modal -->
    <div v-if="showEditModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black opacity-50" @click="showEditModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl shadow-xl max-w-md w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">{{ t('admin.editOrganization') }}</h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.name') }}</label>
              <input
                v-model="editingOrg.name"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.type') }}</label>
              <select
                v-model="editingOrg.type"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white"
              >
                <option value="personal">{{ t('organization.personal') }}</option>
                <option value="business">{{ t('organization.business') }}</option>
              </select>
            </div>
            <div class="flex items-center">
              <input
                v-model="editingOrg.isActive"
                type="checkbox"
                id="orgIsActive"
                class="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
              />
              <label for="orgIsActive" class="ml-2 text-sm text-gray-700 dark:text-gray-300">{{ t('admin.organizationActive') }}</label>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button
              @click="showEditModal = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-lg"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="saveOrg"
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Manage Members Modal -->
    <div v-if="showMembersModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black opacity-50" @click="showMembersModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl shadow-xl max-w-2xl w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
            {{ t('admin.manageMembers') }} - {{ selectedOrg?.name }}
          </h3>

          <!-- Tab navigation -->
          <div class="flex border-b border-gray-200 dark:border-white/10 mb-4">
            <button
              @click="membersTab = 'members'"
              :class="membersTab === 'members' ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'"
              class="py-2 px-4 border-b-2 font-medium text-sm"
            >
              {{ t('admin.members') }} ({{ selectedOrg?.members?.length || 0 }})
            </button>
            <button
              @click="membersTab = 'invites'"
              :class="membersTab === 'invites' ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'"
              class="py-2 px-4 border-b-2 font-medium text-sm"
            >
              {{ t('invite.pendingInvites') }} ({{ pendingInvites.length }})
            </button>
          </div>

          <!-- Members Tab -->
          <div v-if="membersTab === 'members'">
            <!-- Add member -->
            <div class="mb-4 p-4 bg-gray-50 dark:bg-gray-950 rounded-lg">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('admin.addMember') }}</h4>
              <div class="flex gap-2">
                <select
                  v-model="newMember.userId"
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white text-sm"
                >
                  <option value="">{{ t('admin.selectUser') }}</option>
                  <option
                    v-for="user in availableUsers"
                    :key="user.id"
                    :value="user.id"
                  >
                    {{ user.name }} ({{ user.email }})
                  </option>
                </select>
                <select
                  v-model="newMember.role"
                  class="px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white text-sm"
                >
                  <option value="member">{{ t('admin.roleMember') }}</option>
                  <option value="admin">{{ t('admin.roleAdmin') }}</option>
                  <option value="viewer">{{ t('admin.roleViewer') }}</option>
                </select>
                <button
                  @click="addMember"
                  :disabled="!newMember.userId"
                  class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>

            <!-- Members list -->
            <div class="space-y-2 max-h-64 overflow-y-auto">
              <div
                v-for="member in selectedOrg?.members"
                :key="member.userId"
                class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-950 rounded-lg"
              >
                <div class="flex items-center gap-3">
                  <div class="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                    <span class="text-red-600 dark:text-red-400 text-sm font-medium">{{ member.name?.charAt(0)?.toUpperCase() }}</span>
                  </div>
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ member.name }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ member.email }}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <select
                    :value="member.role"
                    @change="updateMemberRole(member.userId, ($event.target as HTMLSelectElement).value)"
                    class="px-2 py-1 border border-gray-300 dark:border-white/10 rounded text-sm dark:bg-white/5 dark:text-white"
                  >
                    <option value="owner">{{ t('admin.roleOwner') }}</option>
                    <option value="admin">{{ t('admin.roleAdmin') }}</option>
                    <option value="member">{{ t('admin.roleMember') }}</option>
                    <option value="viewer">{{ t('admin.roleViewer') }}</option>
                  </select>
                  <button
                    @click="removeMember(member.userId)"
                    class="p-1 text-gray-400 hover:text-red-600"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Invites Tab -->
          <div v-if="membersTab === 'invites'">
            <!-- Invite Member Form -->
            <div class="mb-4 p-4 bg-gray-50 dark:bg-gray-950 rounded-lg">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('invite.inviteMember') }}</h4>
              <div class="flex gap-2">
                <input
                  v-model="newInvite.email"
                  type="email"
                  :placeholder="t('invite.emailPlaceholder')"
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white text-sm"
                />
                <select
                  v-model="newInvite.role"
                  class="px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white text-sm"
                >
                  <option value="member">{{ t('admin.roleMember') }}</option>
                  <option value="admin">{{ t('admin.roleAdmin') }}</option>
                  <option value="viewer">{{ t('admin.roleViewer') }}</option>
                </select>
                <button
                  @click="sendInvite"
                  :disabled="!newInvite.email || inviteSending"
                  class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm flex items-center gap-2"
                >
                  <svg v-if="inviteSending" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {{ t('invite.sendInvite') }}
                </button>
              </div>
              <div v-if="inviteError" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ inviteError }}</div>
              <div v-if="inviteSuccess" class="mt-2 text-sm text-green-600 dark:text-green-400">{{ inviteSuccess }}</div>
            </div>

            <!-- Pending Invites List -->
            <div v-if="invitesLoading" class="flex justify-center py-8">
              <svg class="animate-spin h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <div v-else-if="pendingInvites.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
              {{ t('invite.noPendingInvites') }}
            </div>
            <div v-else class="space-y-2 max-h-64 overflow-y-auto">
              <div
                v-for="invite in pendingInvites"
                :key="invite.id"
                class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-950 rounded-lg"
              >
                <div class="flex items-center gap-3">
                  <div class="h-8 w-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                    <svg class="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ invite.email }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ t('invite.expiresAt') }}: {{ formatDate(invite.expiresAt) }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-1 text-xs font-medium rounded bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200">
                    {{ invite.role }}
                  </span>
                  <button
                    @click="copyInviteLink(invite)"
                    class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    :title="t('invite.copyLink')"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                  <button
                    @click="cancelInvite(invite.id)"
                    class="p-1 text-gray-400 hover:text-red-600"
                    :title="t('invite.cancelInvite')"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <button
              @click="showMembersModal = false"
              class="px-4 py-2 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/[0.07]"
            >
              {{ t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black opacity-50" @click="showDeleteModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl shadow-xl max-w-md w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">{{ t('admin.confirmDelete') }}</h3>
          <p class="text-gray-600 dark:text-gray-400 mb-6">
            {{ t('admin.deleteOrgConfirmation', { name: deletingOrg?.name }) }}
          </p>
          <div class="flex justify-end gap-3">
            <button
              @click="showDeleteModal = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-lg"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="deleteOrg"
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'

definePageMeta({
  middleware: ['admin']
})

const { t } = useI18n()

const organizations = ref<any[]>([])
const allUsers = ref<any[]>([])
const isLoading = ref(false)
const searchQuery = ref('')

const showCreateModal = ref(false)
const showEditModal = ref(false)
const showMembersModal = ref(false)
const showDeleteModal = ref(false)

const newOrg = ref({ name: '', type: 'personal', ownerId: '' })
const editingOrg = ref<any>({})
const selectedOrg = ref<any>(null)
const deletingOrg = ref<any>(null)
const newMember = ref({ userId: '', role: 'member' })

// Invite-related state
const membersTab = ref<'members' | 'invites'>('members')
const pendingInvites = ref<any[]>([])
const invitesLoading = ref(false)
const newInvite = ref({ email: '', role: 'member' })
const inviteSending = ref(false)
const inviteError = ref<string | null>(null)
const inviteSuccess = ref<string | null>(null)

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const availableUsers = computed(() => {
  if (!selectedOrg.value) return allUsers.value
  const memberIds = selectedOrg.value.members?.map((m: any) => m.userId.toString()) || []
  return allUsers.value.filter(u => !memberIds.includes(u.id.toString()))
})

// Watch for tab changes to load invites
watch(membersTab, (newTab) => {
  if (newTab === 'invites' && selectedOrg.value) {
    fetchPendingInvites()
  }
})

// Watch for modal open to reset state
watch(showMembersModal, (isOpen) => {
  if (isOpen) {
    membersTab.value = 'members'
    inviteError.value = null
    inviteSuccess.value = null
    newInvite.value = { email: '', role: 'member' }
  }
})

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const fetchPendingInvites = async () => {
  if (!selectedOrg.value) return
  invitesLoading.value = true
  try {
    const response = await $fetch(`/api/organizations/${selectedOrg.value.id}/invites`)
    if (response.success) {
      pendingInvites.value = response.invites
    }
  } catch (error) {
    console.error('Failed to fetch invites:', error)
    pendingInvites.value = []
  } finally {
    invitesLoading.value = false
  }
}

const sendInvite = async () => {
  if (!newInvite.value.email || !selectedOrg.value) return
  inviteSending.value = true
  inviteError.value = null
  inviteSuccess.value = null

  try {
    const response = await $fetch(`/api/organizations/${selectedOrg.value.id}/invites`, {
      method: 'POST',
      body: {
        email: newInvite.value.email,
        role: newInvite.value.role,
        sendEmailNotification: true
      }
    })

    if (response.success) {
      inviteSuccess.value = response.message
      newInvite.value = { email: '', role: 'member' }
      fetchPendingInvites()
    }
  } catch (error: any) {
    inviteError.value = error.data?.statusMessage || error.message || t('invite.sendError')
  } finally {
    inviteSending.value = false
  }
}

const cancelInvite = async (inviteId: string) => {
  if (!selectedOrg.value) return
  try {
    await $fetch(`/api/organizations/${selectedOrg.value.id}/invites/${inviteId}`, {
      method: 'DELETE'
    })
    pendingInvites.value = pendingInvites.value.filter(i => i.id !== inviteId)
  } catch (error) {
    console.error('Failed to cancel invite:', error)
  }
}

const copyInviteLink = async (invite: any) => {
  const baseUrl = window.location.origin
  const inviteUrl = `${baseUrl}/auth/accept-invite?token=${invite.token || invite.id}`
  try {
    await navigator.clipboard.writeText(inviteUrl)
    inviteSuccess.value = t('invite.linkCopied')
    setTimeout(() => {
      inviteSuccess.value = null
    }, 3000)
  } catch (error) {
    console.error('Failed to copy link:', error)
  }
}

const fetchOrganizations = async () => {
  isLoading.value = true
  try {
    const response = await $fetch('/api/admin/organizations', {
      query: { search: searchQuery.value }
    })
    if (response.success) {
      organizations.value = response.data
    }
  } catch (error) {
    console.error('Failed to fetch organizations:', error)
  } finally {
    isLoading.value = false
  }
}

const fetchUsers = async () => {
  try {
    const response = await $fetch('/api/admin/users', { query: { limit: 100 } })
    if (response.success) {
      allUsers.value = response.data
    }
  } catch (error) {
    console.error('Failed to fetch users:', error)
  }
}

const debouncedSearch = () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(fetchOrganizations, 300)
}

const createOrg = async () => {
  try {
    await $fetch('/api/admin/organizations', {
      method: 'POST',
      body: newOrg.value
    })
    showCreateModal.value = false
    newOrg.value = { name: '', type: 'personal', ownerId: '' }
    fetchOrganizations()
  } catch (error) {
    console.error('Failed to create organization:', error)
  }
}

const editOrg = (org: any) => {
  editingOrg.value = { ...org }
  showEditModal.value = true
}

const saveOrg = async () => {
  try {
    await $fetch(`/api/admin/organizations/${editingOrg.value.id}`, {
      method: 'PATCH',
      body: {
        name: editingOrg.value.name,
        type: editingOrg.value.type,
        isActive: editingOrg.value.isActive
      }
    })
    showEditModal.value = false
    fetchOrganizations()
  } catch (error) {
    console.error('Failed to update organization:', error)
  }
}

const manageMembers = (org: any) => {
  selectedOrg.value = org
  showMembersModal.value = true
}

const addMember = async () => {
  if (!newMember.value.userId || !selectedOrg.value) return
  try {
    await $fetch(`/api/admin/organizations/${selectedOrg.value.id}/members`, {
      method: 'POST',
      body: newMember.value
    })
    newMember.value = { userId: '', role: 'member' }
    // Refresh organization data
    const response = await $fetch(`/api/admin/organizations/${selectedOrg.value.id}`)
    if (response.success) {
      selectedOrg.value = response.data
      // Update in list too
      const index = organizations.value.findIndex(o => o.id === selectedOrg.value.id)
      if (index !== -1) {
        organizations.value[index] = response.data
      }
    }
  } catch (error) {
    console.error('Failed to add member:', error)
  }
}

const updateMemberRole = async (userId: string, role: string) => {
  if (!selectedOrg.value) return
  try {
    await $fetch(`/api/admin/organizations/${selectedOrg.value.id}/members`, {
      method: 'PATCH',
      body: { userId, role }
    })
    // Update local state
    const member = selectedOrg.value.members.find((m: any) => m.userId.toString() === userId)
    if (member) member.role = role
  } catch (error) {
    console.error('Failed to update member role:', error)
  }
}

const removeMember = async (userId: string) => {
  if (!selectedOrg.value) return
  try {
    await $fetch(`/api/admin/organizations/${selectedOrg.value.id}/members`, {
      method: 'DELETE',
      body: { userId }
    })
    // Update local state
    selectedOrg.value.members = selectedOrg.value.members.filter((m: any) => m.userId.toString() !== userId)
  } catch (error) {
    console.error('Failed to remove member:', error)
  }
}

const confirmDelete = (org: any) => {
  deletingOrg.value = org
  showDeleteModal.value = true
}

const deleteOrg = async () => {
  try {
    await $fetch(`/api/admin/organizations/${deletingOrg.value.id}`, {
      method: 'DELETE'
    })
    showDeleteModal.value = false
    fetchOrganizations()
  } catch (error) {
    console.error('Failed to delete organization:', error)
  }
}

onMounted(() => {
  fetchOrganizations()
  fetchUsers()
})
</script>
