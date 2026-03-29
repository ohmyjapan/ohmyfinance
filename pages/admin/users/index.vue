<template>
  <div class="p-6">
    <!-- Page Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
        <div class="flex items-center justify-between relative z-10">
          <div>
            <h1 class="text-2xl font-bold mb-1">{{ t('admin.userManagement') }}</h1>
            <p class="text-primary-light">{{ t('admin.manageRegisteredUsers') }}</p>
          </div>
          <div class="hidden md:block">
            <div class="flex items-center gap-4">
              <div class="text-right">
                <p class="text-sm text-primary-light">{{ t('admin.totalUsers') }}</p>
                <p class="text-3xl font-bold font-mono">{{ pagination.total }}</p>
              </div>
              <div class="w-px h-12 bg-white/30"></div>
              <div class="text-right">
                <p class="text-sm text-primary-light">{{ t('admin.activeUsers') }}</p>
                <p class="text-3xl font-bold font-mono">{{ activeUserCount }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Search and filters -->
    <div class="mb-6">
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="flex flex-col sm:flex-row gap-4">
          <div class="flex-1 flex items-center gap-3">
            <Search class="w-5 h-5 text-gray-400" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('common.search')"
              class="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400"
              @input="debouncedSearch"
            />
          </div>
          <button
            @click="fetchUsers"
            class="px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/[0.07] transition-colors touch-manipulation flex items-center gap-2"
          >
            <RefreshCw class="w-4 h-4" />
            {{ t('common.refresh') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Users table -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
          <thead class="bg-gray-50 dark:bg-white/5">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('admin.user') }}
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('admin.email') }}
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('admin.organizations') }}
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('admin.status') }}
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('admin.registeredAt') }}
              </th>
              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('common.actions') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-white/10">
            <tr v-if="isLoading">
              <td colspan="6" class="px-6 py-12 text-center">
                <div class="flex items-center justify-center gap-2 text-gray-500">
                  <Loader2 class="w-6 h-6 animate-spin text-primary-main" />
                  <span>{{ t('common.loading') }}</span>
                </div>
              </td>
            </tr>
            <tr v-else-if="users.length === 0">
              <td colspan="6" class="px-6 py-12 text-center">
                <Users class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p class="text-gray-500 dark:text-gray-400">{{ t('admin.noUsersFound') }}</p>
              </td>
            </tr>
            <tr
              v-for="user in users"
              :key="user.id"
              class="hover:bg-gray-50 dark:hover:bg-white/[0.03] group transition-colors"
            >
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                  <div class="h-10 w-10 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
                    <span class="text-primary-main dark:text-primary-light font-medium">{{ user.name?.charAt(0)?.toUpperCase() }}</span>
                  </div>
                  <div class="ml-4">
                    <div class="text-sm font-medium text-gray-900 dark:text-white">{{ user.name }}</div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {{ user.email }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div v-if="user.organizations?.length > 0" class="flex flex-wrap gap-1">
                  <span
                    v-for="org in user.organizations"
                    :key="org.id"
                    class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  >
                    {{ org.name }}
                  </span>
                </div>
                <span v-else class="text-gray-400 dark:text-gray-500 text-sm">{{ t('admin.noOrganization') }}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  :class="user.isActive
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'"
                  class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium"
                >
                  {{ user.isActive ? t('admin.active') : t('admin.inactive') }}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {{ formatDate(user.createdAt) }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-right">
                <div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <button
                    @click="editUser(user)"
                    class="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors touch-manipulation"
                    :title="t('common.edit')"
                  >
                    <Pencil class="w-4 h-4" />
                  </button>
                  <button
                    @click="confirmDelete(user)"
                    class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation"
                    :title="t('common.delete')"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="pagination.totalPages > 1" class="px-6 py-4 flex items-center justify-between border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
        <div class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('common.showing') }} {{ (pagination.page - 1) * pagination.limit + 1 }} - {{ Math.min(pagination.page * pagination.limit, pagination.total) }} {{ t('common.of') }} {{ pagination.total }}
        </div>
        <div class="flex gap-2">
          <button
            @click="changePage(pagination.page - 1)"
            :disabled="pagination.page === 1"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
          >
            {{ t('common.previous') }}
          </button>
          <button
            @click="changePage(pagination.page + 1)"
            :disabled="pagination.page === pagination.totalPages"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors touch-manipulation"
          >
            {{ t('common.next') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit User Modal -->
    <div v-if="showEditModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showEditModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('admin.editUser') }}</h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('admin.name') }}</label>
              <input
                v-model="editingUser.name"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('admin.email') }}</label>
              <input
                v-model="editingUser.email"
                type="email"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl dark:bg-white/5 dark:text-white focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
              />
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="editingUser.isActive"
                type="checkbox"
                id="isActive"
                class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 rounded"
              />
              <label for="isActive" class="text-sm text-gray-700 dark:text-gray-300">{{ t('admin.accountActive') }}</label>
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
              @click="saveUser"
              class="px-4 py-2 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
            >
              {{ t('common.save') }}
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
            {{ t('admin.deleteUserConfirmation', { name: deletingUser?.name }) }}
          </p>
          <div class="flex justify-end gap-3">
            <button
              @click="showDeleteModal = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl transition-colors touch-manipulation"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="deleteUser"
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
import { ref, reactive, computed, onMounted } from 'vue'
import {
  Search, RefreshCw, Loader2, Users, Pencil, Trash2, AlertTriangle
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

definePageMeta({
  middleware: ['admin']
})

const { t } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

const users = ref<any[]>([])
const isLoading = ref(false)
const searchQuery = ref('')
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0
})

const showEditModal = ref(false)
const showDeleteModal = ref(false)
const editingUser = ref<any>({})
const deletingUser = ref<any>(null)

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const activeUserCount = computed(() => users.value.filter(u => u.isActive).length)

const fetchUsers = async () => {
  isLoading.value = true
  try {
    const response = await $fetch('/api/admin/users', {
      query: {
        page: pagination.page,
        limit: pagination.limit,
        search: searchQuery.value
      },
      headers: getAuthHeaders()
    })

    if (response.success) {
      users.value = response.data
      Object.assign(pagination, response.pagination)
    }
  } catch (error) {
    console.error('Failed to fetch users:', error)
  } finally {
    isLoading.value = false
  }
}

const debouncedSearch = () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    pagination.page = 1
    fetchUsers()
  }, 300)
}

const changePage = (page: number) => {
  pagination.page = page
  fetchUsers()
}

const editUser = (user: any) => {
  editingUser.value = { ...user }
  showEditModal.value = true
}

const saveUser = async () => {
  try {
    await $fetch(`/api/admin/users/${editingUser.value.id}`, {
      method: 'PATCH',
      body: {
        name: editingUser.value.name,
        email: editingUser.value.email,
        isActive: editingUser.value.isActive
      },
      headers: getAuthHeaders()
    })
    showEditModal.value = false
    fetchUsers()
  } catch (error) {
    console.error('Failed to update user:', error)
  }
}

const confirmDelete = (user: any) => {
  deletingUser.value = user
  showDeleteModal.value = true
}

const deleteUser = async () => {
  try {
    await $fetch(`/api/admin/users/${deletingUser.value.id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    showDeleteModal.value = false
    fetchUsers()
  } catch (error) {
    console.error('Failed to delete user:', error)
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

onMounted(() => {
  fetchUsers()
})
</script>
