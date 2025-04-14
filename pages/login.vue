<template>
  <div class="min-h-screen bg-gray-100 flex flex-col justify-center sm:py-12">
    <div class="p-10 xs:p-0 mx-auto md:w-full md:max-w-md">
      <div class="bg-white shadow w-full rounded-lg divide-y divide-gray-200">
        <div class="px-5 py-7">
          <div class="text-center mb-8">
            <h1 class="font-bold text-2xl text-purple-600 mb-1">TransactHub</h1>
            <p class="text-gray-500 text-sm">Sign in to your account</p>
          </div>

          <!-- Error alert -->
          <div v-if="error" class="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
            <div class="flex">
              <div class="flex-shrink-0">
                <AlertCircle class="h-5 w-5 text-red-400" />
              </div>
              <div class="ml-3">
                <p class="text-sm text-red-700">
                  {{ error }}
                </p>
              </div>
            </div>
          </div>

          <form @submit.prevent="handleLogin">
            <div class="mb-4">
              <label class="block text-gray-700 text-sm font-bold mb-2" for="email">
                Email Address
              </label>
              <input
                  v-model="email"
                  class="border border-gray-300 rounded w-full py-2 px-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  required
              />
            </div>

            <div class="mb-6">
              <label class="block text-gray-700 text-sm font-bold mb-2" for="password">
                Password
              </label>
              <div class="relative">
                <input
                    v-model="password"
                    class="border border-gray-300 rounded w-full py-2 px-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    id="password"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="••••••••"
                    required
                />
                <div
                    @click="showPassword = !showPassword"
                    class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 cursor-pointer hover:text-gray-500"
                >
                  <Eye v-if="showPassword" size="20" />
                  <EyeOff v-else size="20" />
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between mb-6">
              <div class="flex items-center">
                <input
                    v-model="rememberMe"
                    id="remember-me"
                    type="checkbox"
                    class="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                />
                <label for="remember-me" class="ml-2 block text-sm text-gray-700">
                  Remember me
                </label>
              </div>

              <div class="text-sm">
                <a href="#" class="font-medium text-purple-600 hover:text-purple-500">
                  Forgot your password?
                </a>
              </div>
            </div>

            <button
                type="submit"
                class="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 rounded-md text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                :disabled="isLoading"
            >
              <div v-if="isLoading" class="flex items-center justify-center">
                <Loader class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" />
                Signing in...
              </div>
              <span v-else>Sign in</span>
            </button>
          </form>
        </div>

        <div class="p-5 text-center">
          <div class="text-sm text-gray-500">
            Don't have an account? <a href="#" class="text-purple-600 hover:text-purple-500 font-medium">Contact your administrator</a>
          </div>
        </div>
      </div>

      <div class="py-5">
        <div class="grid grid-cols-2 gap-1">
          <div class="text-center sm:text-left whitespace-nowrap">
            <button class="px-5 py-2 mx-auto flex items-center text-sm text-gray-700 hover:text-purple-600 group">
              <Shield class="h-4 w-4 text-gray-400 group-hover:text-purple-500 mr-1" />
              Terms and Conditions
            </button>
          </div>
          <div class="text-center sm:text-right whitespace-nowrap">
            <button class="px-5 py-2 mx-auto flex items-center justify-end text-sm text-gray-700 hover:text-purple-600 group">
              <HelpCircle class="h-4 w-4 text-gray-400 group-hover:text-purple-500 mr-1" />
              Help
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader,
  Shield,
  HelpCircle
} from 'lucide-vue-next'

// State
const email = ref('')
const password = ref('')
const rememberMe = ref(false)
const showPassword = ref(false)
const isLoading = ref(false)
const error = ref('')

// Layout
definePageMeta({
  layout: 'minimal'
})

// Handle login
const router = useRouter()
const handleLogin = async () => {
  isLoading.value = true
  error.value = ''

  try {
    // Simulate API call with a delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    // For demo purposes, accept any email with a valid format and any password
    // In a real app, this would check credentials against an authentication service
    if (!isValidEmail(email.value)) {
      throw new Error('Please enter a valid email address')
    }

    if (password.value.length < 6) {
      throw new Error('Password must be at least 6 characters long')
    }

    // Successful login
    console.log('Login successful:', { email: email.value, rememberMe: rememberMe.value })

    // Redirect to the dashboard
    router.push('/')
  } catch (err) {
    // Handle login error
    error.value = err.message || 'Failed to sign in. Please check your credentials and try again.'
  } finally {
    isLoading.value = false
  }
}

// Validate email format
const isValidEmail = (email: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}
</script>