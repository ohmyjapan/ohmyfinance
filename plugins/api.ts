// plugins/api.ts
import { defineNuxtPlugin } from 'nuxt/app'
import { useAuth } from '~/composables/useAuth'

/**
 * API Plugin for Transaction Middleware System
 *
 * Provides a standardized way to make API requests to our backend services
 * with automatic authentication, error handling, and response formatting.
 */
export default defineNuxtPlugin((nuxtApp) => {
    const apiBaseUrl = process.env.NODE_ENV === 'production'
        ? 'https://api.transacthub.com/v1'
        : 'http://localhost:3001/api/v1'

    // Get auth composable for authentication
    const { getAuthHeader, isAuthenticated } = useAuth()

    // Create API instance
    const api = {
        /**
         * Make a GET request to the API
         */
        async get<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
            return request<T>('GET', endpoint, { params })
        },

        /**
         * Make a POST request to the API
         */
        async post<T>(endpoint: string, data?: any, options: Record<string, any> = {}): Promise<T> {
            return request<T>('POST', endpoint, { data, ...options })
        },

        /**
         * Make a PUT request to the API
         */
        async put<T>(endpoint: string, data?: any, options: Record<string, any> = {}): Promise<T> {
            return request<T>('PUT', endpoint, { data, ...options })
        },

        /**
         * Make a PATCH request to the API
         */
        async patch<T>(endpoint: string, data?: any, options: Record<string, any> = {}): Promise<T> {
            return request<T>('PATCH', endpoint, { data, ...options })
        },

        /**
         * Make a DELETE request to the API
         */
        async delete<T>(endpoint: string, options: Record<string, any> = {}): Promise<T> {
            return request<T>('DELETE', endpoint, options)
        },

        /**
         * Upload files to the API
         */
        async upload<T>(
            endpoint: string,
            files: File[],
            data: Record<string, any> = {},
            onProgress?: (progress: number) => void
        ): Promise<T> {
            const formData = new FormData()

            // Append each file to form data
            files.forEach((file, index) => {
                formData.append(`file${index}`, file)
            })

            // Append additional data
            Object.entries(data).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    formData.append(key, String(value))
                }
            })

            return request<T>('POST', endpoint, {
                data: formData,
                headers: {
                    'Content-Type': 'multipart/form-data'
                },
                onProgress
            })
        },

        // Domain-specific API endpoints
        transactions: {
            /**
             * Get all transactions with optional filters
             */
            getAll: (filters = {}) => api.get('/transactions', filters),

            /**
             * Get a single transaction by ID
             */
            getById: (id: string) => api.get(`/transactions/${id}`),

            /**
             * Create a new transaction
             */
            create: (data: any) => api.post('/transactions', data),

            /**
             * Update a transaction
             */
            update: (id: string, data: any) => api.patch(`/transactions/${id}`, data),

            /**
             * Update transaction status
             */
            updateStatus: (id: string, status: string, notes?: string) =>
                api.patch(`/transactions/${id}/status`, { status, notes }),

            /**
             * Import transactions from file
             */
            import: (files: File[], mappings: Record<string, string>, options = {}, onProgress?: (progress: number) => void) =>
                api.upload('/transactions/import', files, { mappings, options }, onProgress),

            /**
             * Export transactions as CSV/Excel
             */
            export: (filters = {}, format = 'csv') =>
                api.get(`/transactions/export?format=${format}`, filters),

            /**
             * Attach receipt to transaction
             */
            attachReceipt: (transactionId: string, receiptId: string) =>
                api.put(`/transactions/${transactionId}/receipt/${receiptId}`),

            /**
             * Remove receipt from transaction
             */
            detachReceipt: (transactionId: string) =>
                api.delete(`/transactions/${transactionId}/receipt`)
        },

        receipts: {
            /**
             * Get all receipts with optional filters
             */
            getAll: (filters = {}) => api.get('/receipts', filters),

            /**
             * Get a single receipt by ID
             */
            getById: (id: string) => api.get(`/receipts/${id}`),

            /**
             * Upload a new receipt
             */
            upload: (file: File, metadata = {}, onProgress?: (progress: number) => void) =>
                api.upload('/receipts', [file], metadata, onProgress),

            /**
             * Update receipt metadata
             */
            update: (id: string, data: any) => api.patch(`/receipts/${id}`, data),

            /**
             * Delete a receipt
             */
            delete: (id: string) => api.delete(`/receipts/${id}`),

            /**
             * Find transactions matching a receipt
             */
            findMatches: (receiptId: string) => api.get(`/receipts/${receiptId}/matches`),

            /**
             * Match a receipt with a transaction
             */
            matchTransaction: (receiptId: string, transactionId: string) =>
                api.put(`/receipts/${receiptId}/match/${transactionId}`),

            /**
             * Unmatch a receipt from its transaction
             */
            unmatch: (receiptId: string) => api.delete(`/receipts/${receiptId}/match`)
        },

        shipments: {
            /**
             * Get all shipments with optional filters
             */
            getAll: (filters = {}) => api.get('/shipments', filters),

            /**
             * Get a single shipment by ID
             */
            getById: (id: string) => api.get(`/shipments/${id}`),

            /**
             * Create a new shipment
             */
            create: (data: any) => api.post('/shipments', data),

            /**
             * Update a shipment
             */
            update: (id: string, data: any) => api.patch(`/shipments/${id}`, data),

            /**
             * Update shipment status
             */
            updateStatus: (id: string, status: string, location?: string, notes?: string) =>
                api.patch(`/shipments/${id}/status`, { status, location, notes }),

            /**
             * Delete a shipment
             */
            delete: (id: string) => api.delete(`/shipments/${id}`),

            /**
             * Send tracking information email
             */
            sendTrackingInfo: (id: string, recipients: string[], message?: string) =>
                api.post(`/shipments/${id}/send-tracking`, { recipients, message }),

            /**
             * Get tracking information
             */
            getTracking: (id: string) => api.get(`/shipments/${id}/tracking`)
        },

        analytics: {
            /**
             * Get transaction analytics data
             */
            getTransactionStats: (dateRange?: { from: string, to: string }) =>
                api.get('/analytics/transactions', dateRange),

            /**
             * Get receipt analytics data
             */
            getReceiptStats: (dateRange?: { from: string, to: string }) =>
                api.get('/analytics/receipts', dateRange),

            /**
             * Get shipment analytics data
             */
            getShipmentStats: (dateRange?: { from: string, to: string }) =>
                api.get('/analytics/shipments', dateRange),

            /**
             * Get geographic distribution data
             */
            getGeographicData: (dateRange?: { from: string, to: string }) =>
                api.get('/analytics/geographic', dateRange)
        },

        users: {
            /**
             * Get user profile
             */
            getProfile: () => api.get('/users/profile'),

            /**
             * Update user profile
             */
            updateProfile: (data: any) => api.put('/users/profile', data),

            /**
             * Change user password
             */
            changePassword: (currentPassword: string, newPassword: string) =>
                api.post('/users/change-password', { currentPassword, newPassword })
        }
    }

    /**
     * Generic request function for all API calls
     */
    async function request<T>(
        method: string,
        endpoint: string,
        options: {
            params?: Record<string, any>;
            data?: any;
            headers?: Record<string, string>;
            onProgress?: (progress: number) => void;
        } = {}
    ): Promise<T> {
        try {
            // Build URL with query parameters
            let url = `${apiBaseUrl}${endpoint}`

            if (options.params && Object.keys(options.params).length > 0) {
                const queryParams = new URLSearchParams()

                Object.entries(options.params).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        // Handle arrays and objects
                        if (typeof value === 'object') {
                            queryParams.append(key, JSON.stringify(value))
                        } else {
                            queryParams.append(key, String(value))
                        }
                    }
                })

                url += `?${queryParams.toString()}`
            }

            // Get auth headers if authenticated
            const authHeaders = isAuthenticated.value ? getAuthHeader() : {}

            // Set up request options
            const fetchOptions: RequestInit = {
                method,
                headers: {
                    'Accept': 'application/json',
                    ...authHeaders,
                    ...options.headers
                }
            }

            // Add body for methods that support it
            if (['POST', 'PUT', 'PATCH'].includes(method) && options.data !== undefined) {
                if (options.data instanceof FormData) {
                    // FormData should be sent as is
                    fetchOptions.body = options.data
                } else {
                    // JSON stringify other data types
                    fetchOptions.body = JSON.stringify(options.data)

                    // Add Content-Type header if not already set
                    if (!options.headers || !options.headers['Content-Type']) {
                        fetchOptions.headers = {
                            ...fetchOptions.headers,
                            'Content-Type': 'application/json'
                        }
                    }
                }
            }

            // Handle upload progress if a callback is provided
            if (options.onProgress && fetchOptions.body instanceof FormData) {
                const xhr = new XMLHttpRequest()

                // Return a Promise that will resolve/reject based on the XHR events
                return new Promise<T>((resolve, reject) => {
                    xhr.upload.addEventListener('progress', (event) => {
                        if (event.lengthComputable && options.onProgress) {
                            const progress = Math.round((event.loaded / event.total) * 100)
                            options.onProgress(progress)
                        }
                    })

                    xhr.addEventListener('load', () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            try {
                                const response = JSON.parse(xhr.responseText)
                                resolve(response)
                            } catch (e) {
                                resolve({} as T)
                            }
                        } else {
                            try {
                                const errorResponse = JSON.parse(xhr.responseText)
                                reject(new ApiError(xhr.status, errorResponse.message || 'An error occurred', errorResponse))
                            } catch (e) {
                                reject(new ApiError(xhr.status, 'An error occurred'))
                            }
                        }
                    })

                    xhr.addEventListener('error', () => {
                        reject(new ApiError(0, 'Network error occurred'))
                    })

                    xhr.open(method, url)

                    // Add headers
                    Object.entries(fetchOptions.headers || {}).forEach(([key, value]) => {
                        // Skip Content-Type for FormData (browser will set it with boundary)
                        if (key !== 'Content-Type' || !(fetchOptions.body instanceof FormData)) {
                            xhr.setRequestHeader(key, value as string)
                        }
                    })

                    xhr.send(fetchOptions.body as FormData)
                })
            }

            // Make the fetch request
            const response = await fetch(url, fetchOptions)

            // Check if the response is OK (status in the range 200-299)
            if (!response.ok) {
                let errorData
                try {
                    errorData = await response.json()
                } catch (e) {
                    errorData = { message: 'An error occurred' }
                }

                throw new ApiError(
                    response.status,
                    errorData.message || `API error: ${response.statusText}`,
                    errorData
                )
            }

            // Check if response has content
            const contentType = response.headers.get('content-type')
            if (contentType && contentType.includes('application/json')) {
                return await response.json() as T
            } else {
                // Handle empty responses or non-JSON responses
                return {} as T
            }
        } catch (error) {
            if (error instanceof ApiError) {
                // Re-throw API errors
                throw error
            } else {
                // Wrap other errors
                console.error('API Request Error:', error)
                throw new ApiError(0, error.message || 'An unexpected error occurred')
            }
        }
    }

    // API Error class for consistent error handling
    class ApiError extends Error {
        status: number
        data?: any

        constructor(status: number, message: string, data?: any) {
            super(message)
            this.name = 'ApiError'
            this.status = status
            this.data = data
        }
    }

    // Register API in Nuxt app
    nuxtApp.provide('api', api)

    return {
        provide: {
            api
        }
    }
})

// Type declaration for better TypeScript support
declare module '#app' {
    interface NuxtApp {
        $api: ReturnType<typeof useApi>
    }
}

declare module '@vue/runtime-core' {
    interface ComponentCustomProperties {
        $api: ReturnType<typeof useApi>
    }
}

// Helper function to access the API in components
export const useApi = () => {
    const nuxtApp = useNuxtApp()
    return nuxtApp.$api
}