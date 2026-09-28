// stores/shipment.ts
import { defineStore } from 'pinia'
import { useUserStore } from '~/stores/user'

export interface ShipmentAddress {
    name?: string
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
}

export interface ShipmentEvent {
    requestId?: string
    status?: Shipment['status']
    type: string
    title: string
    timestamp: string
    description?: string
    location?: string
}

export interface Shipment {
    id: string
    trackingNumber?: string
    carrier?: string
    status: 'pending' | 'processing' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed' | 'returned' | 'delayed' | 'exception' | 'cancelled'
    createdAt: string
    updatedAt: string
    estimatedDelivery?: string
    transactionId?: string
    customerName?: string
    customerEmail?: string
    address?: ShipmentAddress
    shippingAddress?: ShipmentAddress
    transactionIds?: string[]
    transactions?: Array<{ _id: string; referenceNumber?: string; date?: string; amount?: number; currency?: string; description?: string }>
    events: ShipmentEvent[]
    serviceType?: string
    packageType?: string
    weight?: { value?: number; unit?: string }
    weightUnit?: string
    dimensions?: { length?: number; width?: number; height?: number; unit?: string }
    insurance?: number
    signatureRequired?: boolean
    [key: string]: any
}

export interface ShipmentFilters {
    status?: string
    carrier?: string
    dateFrom?: string
    dateTo?: string
    deliveryWindow?: string
    country?: string
    search?: string
}

interface ShipmentStats {
    total: number
    pending: number
    processing: number
    inTransit: number
    delivered: number
    failed: number
    cancelled: number
}

export const useShipmentStore = defineStore('shipment', {
    state: () => ({
        shipments: [] as Shipment[],
        currentShipment: null as Shipment | null,
        isLoading: false,
        error: null as string | null,
        filters: {} as ShipmentFilters,
        searchQuery: '',
        requestSequence: 0,
        stats: {
            total: 0,
            pending: 0,
            processing: 0,
            inTransit: 0,
            delivered: 0,
            failed: 0,
            cancelled: 0
        }
    }),

    getters: {
        filteredShipments(): Shipment[] {
            let result = [...this.shipments]

            // Apply search filter
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase()
                result = result.filter(shipment =>
                    (shipment.trackingNumber || '').toLowerCase().includes(query) ||
                    (shipment.customerName || shipment.shippingAddress?.name || '').toLowerCase().includes(query) ||
                    (shipment.customerEmail && shipment.customerEmail.toLowerCase().includes(query)) ||
                    (shipment.transactionId && shipment.transactionId.toLowerCase().includes(query)) ||
                    shipment.id.toLowerCase().includes(query)
                )
            }

            // Apply status filter
            if (this.filters.status) {
                result = result.filter(shipment => shipment.status === this.filters.status)
            }

            // Apply carrier filter
            if (this.filters.carrier) {
                result = result.filter(shipment => shipment.carrier === this.filters.carrier)
            }

            // Apply date range filter
            if (this.filters.dateFrom) {
                const fromDate = new Date(this.filters.dateFrom)
                result = result.filter(shipment => new Date(shipment.createdAt) >= fromDate)
            }

            if (this.filters.dateTo) {
                const toDate = new Date(this.filters.dateTo)
                toDate.setHours(23, 59, 59, 999) // End of the day
                result = result.filter(shipment => new Date(shipment.createdAt) <= toDate)
            }

            // Apply delivery window filter
            if (this.filters.deliveryWindow) {
                const now = new Date()
                let cutoffDate = new Date()

                if (this.filters.deliveryWindow === 'today') {
                    cutoffDate.setHours(0, 0, 0, 0)
                    result = result.filter(shipment => {
                        const etaDate = new Date(shipment.estimatedDelivery || '')
                        return etaDate.toDateString() === now.toDateString()
                    })
                } else if (this.filters.deliveryWindow === 'tomorrow') {
                    cutoffDate.setDate(now.getDate() + 1)
                    cutoffDate.setHours(0, 0, 0, 0)
                    result = result.filter(shipment => {
                        const etaDate = new Date(shipment.estimatedDelivery || '')
                        return etaDate.toDateString() === cutoffDate.toDateString()
                    })
                } else if (this.filters.deliveryWindow === 'this_week') {
                    const thisWeekEnd = new Date(now)
                    thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()))

                    result = result.filter(shipment => {
                        const etaDate = new Date(shipment.estimatedDelivery || '')
                        return etaDate >= now && etaDate <= thisWeekEnd
                    })
                } else if (this.filters.deliveryWindow === 'next_week') {
                    const thisWeekEnd = new Date(now)
                    thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()))

                    const nextWeekStart = new Date(thisWeekEnd)
                    nextWeekStart.setDate(thisWeekEnd.getDate() + 1)

                    const nextWeekEnd = new Date(nextWeekStart)
                    nextWeekEnd.setDate(nextWeekStart.getDate() + 6)

                    result = result.filter(shipment => {
                        const etaDate = new Date(shipment.estimatedDelivery || '')
                        return etaDate >= nextWeekStart && etaDate <= nextWeekEnd
                    })
                } else if (this.filters.deliveryWindow === 'overdue') {
                    result = result.filter(shipment => {
                        if (!shipment.estimatedDelivery) return false
                        const etaDate = new Date(shipment.estimatedDelivery)
                        return etaDate < now && shipment.status !== 'delivered'
                    })
                }
            }

            // Apply country filter
            if (this.filters.country) {
                result = result.filter(shipment => (shipment.shippingAddress || shipment.address)?.country === this.filters.country)
            }

            return result
        }
    },

    actions: {
        _getAuthHeaders() {
            const userStore = useUserStore()
            return userStore.authHeader
        },

        contextKey() {
            const user = useUserStore()
            return JSON.stringify([user.sessionId, user.user?.id, user.currentOrganization?.id])
        },

        resetContext() {
            this.requestSequence++
            this.shipments = []
            this.currentShipment = null
            this.stats = { total: 0, pending: 0, processing: 0, inTransit: 0, delivered: 0, failed: 0, cancelled: 0 }
            this.error = null
            this.isLoading = false
        },

        beginRequest() {
            this.isLoading = true
            this.error = null
            return { sequence: ++this.requestSequence, context: this.contextKey(), headers: { ...this._getAuthHeaders() } }
        },

        isCurrent(request: { sequence: number; context: string }) {
            return request.sequence === this.requestSequence && request.context === this.contextKey()
        },

        requestFailed(request: { sequence: number; context: string }, error: any) {
            if (this.isCurrent(request)) this.error = error?.data?.statusMessage || error?.message || 'Shipment request failed'
        },

        finishRequest(request: { sequence: number; context: string }) {
            if (this.isCurrent(request)) this.isLoading = false
        },

        async fetchShipments() {
            this.shipments = []
            const request = this.beginRequest()
            try {
                const data = await $fetch<{ shipments: Shipment[]; total: number }>('/api/shipments', { headers: request.headers })
                if (!this.isCurrent(request)) return
                this.shipments = data.shipments
                await this.fetchStats(request)
            } catch (error) { this.requestFailed(request, error) }
            finally { this.finishRequest(request) }
        },

        async fetchShipmentById(id: string) {
            this.currentShipment = null
            const request = this.beginRequest()
            try {
                const data = await $fetch<Shipment>(`/api/shipments/${id}`, { headers: request.headers })
                if (this.isCurrent(request)) this.currentShipment = data
            } catch (error) { this.requestFailed(request, error) }
            finally { this.finishRequest(request) }
        },

        async saveShipment(url: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, create = false, statusEnvelope = false) {
            const request = this.beginRequest()
            try {
                const response = await $fetch<Shipment | { shipment: Shipment }>(url, { method, body, headers: request.headers })
                if (!this.isCurrent(request)) return null
                const shipment = (statusEnvelope ? response.shipment : response) as Shipment
                const index = this.shipments.findIndex(item => item.id === shipment.id)
                if (index !== -1) this.shipments[index] = shipment
                else if (create) this.shipments.unshift(shipment)
                if (this.currentShipment?.id === shipment.id) this.currentShipment = shipment
                await this.fetchStats(request)
                return this.isCurrent(request) ? shipment : null
            } catch (error) { this.requestFailed(request, error); return null }
            finally { this.finishRequest(request) }
        },

        async createShipment(data: Partial<Shipment>) {
            return this.saveShipment('/api/shipments', 'POST', data, true)
        },

        async updateShipment(id: string, data: Partial<Shipment>) {
            return this.saveShipment(`/api/shipments/${id}`, 'PATCH', data)
        },

        async updateShipmentStatus(id: string, status: Shipment['status'], notes?: string, location?: string) {
            return this.saveShipment(`/api/shipments/${id}/update-status`, 'POST', { status, statusNotes: notes, location }, false, true)
        },

        async addTrackingEvent(id: string, data: Partial<ShipmentEvent>) {
            data.requestId ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
            return this.saveShipment(`/api/shipments/${id}/tracking`, 'POST', data)
        },

        async fetchStats(parent?: { sequence: number; context: string; headers: Record<string, string> }) {
            const request = parent || this.beginRequest()
            try {
                const data = await $fetch<{ stats: ShipmentStats }>('/api/shipments?stats=true', { headers: request.headers })
                if (this.isCurrent(request)) this.stats = data.stats
            } catch (error) {
                // A statistics failure must not turn a confirmed write into a failed write.
                if (!parent) this.requestFailed(request, error)
            } finally { if (!parent) this.finishRequest(request) }
        },

        resetFilters() {
            this.filters = {}
            this.searchQuery = ''
        },

        setSearchQuery(query: string) {
            this.searchQuery = query
        },

        setFilters(filters: ShipmentFilters) {
            this.filters = filters
        }
    }
})
