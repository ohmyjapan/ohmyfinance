<template>
  <div class="p-6">
    <!-- Page Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
        <div class="flex items-center justify-between relative z-10">
          <div>
            <h1 class="text-2xl font-bold mb-1">{{ t('admin.organizationManagement') }}</h1>
            <p class="text-primary-light">{{ t('admin.manageOrganizations') }}</p>
          </div>
          <button
            @click="showCreateModal = true"
            class="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-sm transition-all duration-300 touch-manipulation"
          >
            <Plus class="w-5 h-5" />
            {{ t('admin.createOrganization') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <StatCard
        :title="t('admin.totalOrganizations')"
        :value="organizations.length.toString()"
        icon="Package"
        color="blue"
      />
      <StatCard
        :title="t('admin.totalMembers')"
        :value="totalMembers.toString()"
        icon="Users"
        color="green"
      />
      <StatCard
        :title="t('admin.activeOrganizations')"
        :value="activeOrgs.toString()"
        icon="Activity"
        color="amber"
      />
    </div>

    <!-- Search -->
    <div class="mb-6">
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="flex items-center gap-3">
          <Search class="w-5 h-5 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('common.search')"
            class="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400"
            @input="debouncedSearch"
          />
        </div>
      </div>
    </div>

    <!-- Organizations grid -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <Loader2 class="w-8 h-8 text-primary-main animate-spin" />
    </div>

    <div v-else-if="organizations.length === 0" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-12 text-center">
      <Building2 class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
      <p class="text-gray-500 dark:text-gray-400">{{ t('admin.noOrganizationsFound') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="org in organizations"
        :key="org.id"
        class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group"
      >
        <div class="flex justify-between items-start mb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
              <Building2 class="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ org.name }}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ org.slug }}</p>
            </div>
          </div>
          <span
            :class="org.isActive
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-red-500/10 text-red-600 dark:text-red-400'"
            class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium"
          >
            {{ org.isActive ? t('admin.active') : t('admin.inactive') }}
          </span>
        </div>

        <div class="mb-4">
          <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400">
            {{ org.type === 'business' ? t('organization.business') : t('organization.personal') }}
          </span>
        </div>

        <div class="mb-4">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">{{ t('admin.members') }} ({{ org.members?.length || 0 }})</p>
          <div class="flex -space-x-2">
            <div
              v-for="(member, index) in (org.members || []).slice(0, 5)"
              :key="member.userId"
              class="h-8 w-8 rounded-full bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center border-2 border-white dark:border-gray-800"
              :title="member.name"
            >
              <span class="text-primary-main dark:text-primary-light text-xs font-medium">{{ member.name?.charAt(0)?.toUpperCase() }}</span>
            </div>
            <div
              v-if="(org.members?.length || 0) > 5"
              class="h-8 w-8 rounded-full bg-gray-500/10 dark:bg-white/5 flex items-center justify-center border-2 border-white dark:border-gray-800"
            >
              <span class="text-gray-600 dark:text-gray-400 text-xs">+{{ org.members.length - 5 }}</span>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-1 pt-4 border-t border-gray-200 dark:border-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <button
            @click="manageMembers(org)"
            class="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 transition-colors touch-manipulation"
            :title="t('admin.members')"
          >
            <Users class="w-4 h-4" />
          </button>
          <button
            @click="editOrg(org)"
            class="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors touch-manipulation"
            :title="t('common.edit')"
          >
            <Pencil class="w-4 h-4" />
          </button>
          <button
            @click="confirmDelete(org)"
            class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation"
            :title="t('common.delete')"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Create Organization Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showCreateModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('admin.createOrganization') }}</h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.name') }}</label>
              <input
                v-model="newOrg.name"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
                :placeholder="t('organization.namePlaceholder')"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.type') }}</label>
              <select
                v-model="newOrg.type"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white"
              >
                <option value="personal">{{ t('organization.personal') }}</option>
                <option value="business">{{ t('organization.business') }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('admin.owner') }} ({{ t('common.optional') }})</label>
              <select
                v-model="newOrg.ownerId"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white"
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
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl transition-colors touch-manipulation"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="createOrg"
              :disabled="!newOrg.name"
              class="px-4 py-2 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 transition-all duration-300 touch-manipulation"
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
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showEditModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('admin.editOrganization') }}</h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.name') }}</label>
              <input
                v-model="editingOrg.name"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('organization.type') }}</label>
              <select
                v-model="editingOrg.type"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white"
              >
                <option value="personal">{{ t('organization.personal') }}</option>
                <option value="business">{{ t('organization.business') }}</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="editingOrg.isActive"
                type="checkbox"
                id="orgIsActive"
                class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 rounded"
              />
              <label for="orgIsActive" class="text-sm text-gray-700 dark:text-gray-300">{{ t('admin.organizationActive') }}</label>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button
              @click="showEditModal = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl transition-colors touch-manipulation"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="saveOrg"
              class="px-4 py-2 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
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
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showMembersModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-2xl w-full p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {{ t('admin.manageMembers') }} - {{ selectedOrg?.name }}
          </h3>

          <!-- Tab navigation -->
          <div class="flex border-b border-gray-200 dark:border-white/10 mb-4">
            <button
              @click="membersTab = 'members'"
              :class="membersTab === 'members' ? 'border-primary-main text-primary-main dark:text-primary-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'"
              class="py-2 px-4 border-b-2 font-medium text-sm transition-colors touch-manipulation"
            >
              {{ t('admin.members') }} ({{ selectedOrg?.members?.length || 0 }})
            </button>
            <button
              @click="membersTab = 'invites'"
              :class="membersTab === 'invites' ? 'border-primary-main text-primary-main dark:text-primary-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'"
              class="py-2 px-4 border-b-2 font-medium text-sm transition-colors touch-manipulation"
            >
              {{ t('invite.pendingInvites') }} ({{ pendingInvites.length }})
            </button>
          </div>

          <!-- Members Tab -->
          <div v-if="membersTab === 'members'">
            <div class="mb-4 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('admin.addMember') }}</h4>
              <div class="flex gap-2">
                <select
                  v-model="newMember.userId"
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white text-sm"
                >
                  <option value="">{{ t('admin.selectUser') }}</option>
                  <option v-for="user in availableUsers" :key="user.id" :value="user.id">
                    {{ user.name }} ({{ user.email }})
                  </option>
                </select>
                <select
                  v-model="newMember.role"
                  class="px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white text-sm"
                >
                  <option value="member">{{ t('admin.roleMember') }}</option>
                  <option value="admin">{{ t('admin.roleAdmin') }}</option>
                  <option value="viewer">{{ t('admin.roleViewer') }}</option>
                </select>
                <button
                  @click="addMember"
                  :disabled="!newMember.userId"
                  class="px-4 py-2 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 text-sm transition-all duration-300 touch-manipulation"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>

            <div class="space-y-2 max-h-64 overflow-y-auto">
              <div
                v-for="member in selectedOrg?.members"
                :key="member.userId"
                class="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div class="h-8 w-8 rounded-full bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
                    <span class="text-primary-main dark:text-primary-light text-sm font-medium">{{ member.name?.charAt(0)?.toUpperCase() }}</span>
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
                    class="px-2 py-1 border border-gray-300 dark:border-white/10 rounded-lg text-sm dark:bg-white/5 dark:text-white"
                  >
                    <option value="owner">{{ t('admin.roleOwner') }}</option>
                    <option value="admin">{{ t('admin.roleAdmin') }}</option>
                    <option value="member">{{ t('admin.roleMember') }}</option>
                    <option value="viewer">{{ t('admin.roleViewer') }}</option>
                  </select>
                  <button
                    @click="removeMember(member.userId)"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Invites Tab -->
          <div v-if="membersTab === 'invites'">
            <div class="mb-4 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('invite.inviteMember') }}</h4>
              <div class="flex gap-2">
                <input
                  v-model="newInvite.email"
                  type="email"
                  :placeholder="t('invite.emailPlaceholder')"
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white text-sm"
                />
                <select
                  v-model="newInvite.role"
                  class="px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white text-sm"
                >
                  <option value="member">{{ t('admin.roleMember') }}</option>
                  <option value="admin">{{ t('admin.roleAdmin') }}</option>
                  <option value="viewer">{{ t('admin.roleViewer') }}</option>
                </select>
                <button
                  @click="sendInvite"
                  :disabled="!newInvite.email || inviteSending"
                  class="px-4 py-2 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 text-sm flex items-center gap-2 transition-all duration-300 touch-manipulation"
                >
                  <Loader2 v-if="inviteSending" class="w-4 h-4 animate-spin" />
                  <Mail v-else class="w-4 h-4" />
                  {{ t('invite.sendInvite') }}
                </button>
              </div>
              <div v-if="inviteError" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ inviteError }}</div>
              <div v-if="inviteSuccess" class="mt-2 text-sm text-green-600 dark:text-green-400">{{ inviteSuccess }}</div>
            </div>

            <div v-if="invitesLoading" class="flex justify-center py-8">
              <Loader2 class="w-6 h-6 text-primary-main animate-spin" />
            </div>
            <div v-else-if="pendingInvites.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
              {{ t('invite.noPendingInvites') }}
            </div>
            <div v-else class="space-y-2 max-h-64 overflow-y-auto">
              <div
                v-for="invite in pendingInvites"
                :key="invite.id"
                class="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10"
              >
                <div class="flex items-center gap-3">
                  <div class="h-8 w-8 rounded-full bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
                    <Mail class="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ invite.email }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ t('invite.expiresAt') }}: {{ formatDate(invite.expiresAt) }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="bg-primary-main/10 text-primary-main dark:text-primary-light px-2.5 py-1 text-xs font-medium rounded-lg">
                    {{ invite.role }}
                  </span>
                  <button
                    @click="copyInviteLink(invite)"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 transition-colors touch-manipulation"
                    :title="t('invite.copyLink')"
                  >
                    <Copy class="w-4 h-4" />
                  </button>
                  <button
                    @click="cancelInvite(invite.id)"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation"
                    :title="t('invite.cancelInvite')"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <button
              @click="showMembersModal = false"
              class="px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
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
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showDeleteModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center">
              <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('admin.confirmDelete') }}</h3>
          </div>
          <p class="text-gray-600 dark:text-gray-400 mb-6">
            {{ t('admin.deleteOrgConfirmation', { name: deletingOrg?.name }) }}
          </p>
          <div class="flex justify-end gap-3">
            <button
              @click="showDeleteModal = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl transition-colors touch-manipulation"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="deleteOrg"
              class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-lg shadow-red-600/25 transition-all duration-300 touch-manipulation"
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
import {
  Plus, Search, Loader2, Building2, Users, Pencil, Trash2,
  X, Mail, Copy, AlertTriangle
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

definePageMeta({
  middleware: ['admin']
})

const { t } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

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

// Computed stats
const totalMembers = computed(() => organizations.value.reduce((sum, org) => sum + (org.members?.length || 0), 0))
const activeOrgs = computed(() => organizations.value.filter(org => org.isActive).length)

const availableUsers = computed(() => {
  if (!selectedOrg.value) return allUsers.value
  const memberIds = selectedOrg.value.members?.map((m: any) => m.userId.toString()) || []
  return allUsers.value.filter(u => !memberIds.includes(u.id.toString()))
})

watch(membersTab, (newTab) => {
  if (newTab === 'invites' && selectedOrg.value) {
    fetchPendingInvites()
  }
})

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
    const response = await $fetch(`/api/organizations/${selectedOrg.value.id}/invites`, {
      headers: getAuthHeaders()
    })
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
      },
      headers: getAuthHeaders()
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
      method: 'DELETE',
      headers: getAuthHeaders()
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
      query: { search: searchQuery.value },
      headers: getAuthHeaders()
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
    const response = await $fetch('/api/admin/users', {
      query: { limit: 100 },
      headers: getAuthHeaders()
    })
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
      body: newOrg.value,
      headers: getAuthHeaders()
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
      },
      headers: getAuthHeaders()
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
      body: newMember.value,
      headers: getAuthHeaders()
    })
    newMember.value = { userId: '', role: 'member' }
    const response = await $fetch(`/api/admin/organizations/${selectedOrg.value.id}`, {
      headers: getAuthHeaders()
    })
    if (response.success) {
      selectedOrg.value = response.data
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
      body: { userId, role },
      headers: getAuthHeaders()
    })
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
      body: { userId },
      headers: getAuthHeaders()
    })
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
      method: 'DELETE',
      headers: getAuthHeaders()
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
