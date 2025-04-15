// stores/shipment.ts
import { defineStore } from 'pinia'

export interface ShipmentAddress {
    name: string
    line1: string
    line2?: string
    city: string
    state: string
    postalCode: string
    country: string
}

export interface ShipmentEvent {
    type: string
    title: string
    timestamp: string
    description?: string
    location?: string
}

export interface Shipment {
    id: string
    trackingNumber: string
    carrier: string
    status: 'pending' | 'processing' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delayed' | 'exception' | 'cancelled'
    createdAt: string
    updatedAt: string
    estimatedDelivery?: string
    transactionId?: string
    customerName: string
    customerEmail?: string
    address: ShipmentAddress
    events: ShipmentEvent[]
    serviceType?: string
    packageType?: string
    weight?: number
    weightUnit?: string
    dimensions?: string
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

export const useShipmentStore = defineStore('shipment', {
    state: () => ({
        shipments: [] as Shipment[],
        currentShipment: null as Shipment | null,
        isLoading: false,
        error: null as string | null,
        filters: {} as ShipmentFilters,
        searchQuery: '',
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
                    shipment.trackingNumber.toLowerCase().includes(query) ||
                    shipment.customerName.toLowerCase().includes(query) ||
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
                result = result.filter(shipment => shipment.address.country === this.filters.country)
            }

            return result
        }
    },

    actions: {
        async fetchShipments() {
            this.isLoading = true
            this.error = null

            try {
                const { data } = await useFetch('/api/shipments')
                this.shipments = data.value as Shipment[]

                // Fetch statistics
                await this.fetchStats()
            } catch (error: any) {
                this.error = error.message || 'Failed to fetch shipments'
                console.error('Error fetching shipments:', error)
            } finally {
                this.isLoading = false
            }
        },

        async fetchShipmentById(id: string) {
            this.isLoading = true
            this.error = null

            try {
                const { data } = await useFetch(`/api/shipments/${id}`)
                this.currentShipment = data.value as Shipment
            } catch (error: any) {
                this.error = error.message || `Failed to fetch shipment ${id}`
                console.error(`Error fetching shipment ${id}:`, error)
            } finally {
                this.isLoading = false
            }
        },

        async createShipment(shipmentData: Partial<Shipment>) {
            this.isLoading = true
            this.error = null

            try {
                const { data } = await useFetch('/api/shipments/create', {
                    method: 'POST',
                    body: shipmentData
                })

                const newShipment = data.value as Shipment

                // Add to local state
                this.shipments.unshift(newShipment)

                // Update stats
                await this.fetchStats()

                return newShipment
            } catch (error: any) {
                this.error = error.message || 'Failed to create shipment'
                console.error('Error creating shipment:', error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async updateShipment(id: string, shipmentData: Partial<Shipment>) {
            this.isLoading = true
            this.error = null

            try {
                const { data } = await useFetch(`/api/shipments/${id}/update`, {
                    method: 'POST',
                    body: shipmentData
                })

                const updatedShipment = data.value as Shipment

                // Update in local state
                const index = this.shipments.findIndex(s => s.id === id)
                if (index !== -1) {
                    this.shipments[index] = updatedShipment
                }

                // Update current shipment if it's loaded
                if (this.currentShipment && this.currentShipment.id === id) {
                    this.currentShipment = updatedShipment
                }

                // Update stats if status changed
                if (shipmentData.status) {
                    await this.fetchStats()
                }

                return updatedShipment
            } catch (error: any) {
                this.error = error.message || `Failed to update shipment ${id}`
                console.error(`Error updating shipment ${id}:`, error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async updateShipmentStatus(id: string, status: Shipment['status'], notes?: string, location?: string) {
            this.isLoading = true
            this.error = null

            try {
                const eventData = {
                    status,
                    statusNotes: notes,
                    location
                }

                const { data } = await useFetch(`/api/shipments/${id}/update`, {
                    method: 'POST',
                    body: eventData
                })

                const updatedShipment = data.value as Shipment

                // Update in local state
                const index = this.shipments.findIndex(s => s.id === id)
                if (index !== -1) {
                    this.shipments[index] = updatedShipment
                }

                // Update current shipment if it's loaded
                if (this.currentShipment && this.currentShipment.id === id) {
                    this.currentShipment = updatedShipment
                }

                // Update stats
                await this.fetchStats()

                return updatedShipment
            } catch (error: any) {
                this.error = error.message || `Failed to update shipment status for ${id}`
                console.error(`Error updating shipment status for ${id}:`, error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async addTrackingEvent(shipmentId: string, eventData: Partial<ShipmentEvent>) {
            this.isLoading = true
            this.error = null

            try {
                const { data } = await useFetch(`/api/shipments/${shipmentId}/tracking`, {
                    method: 'POST',
                    body: eventData
                })

                const updatedShipment = data.value as Shipment

                // Update in local state
                const index = this.shipments.findIndex(s => s.id === shipmentId)
                if (index !== -1) {
                    this.shipments[index] = updatedShipment
                }

                // Update current shipment if it's loaded
                if (this.currentShipment && this.currentShipment.id === shipmentId) {
                    this.currentShipment = updatedShipment
                }

                return updatedShipment
            } catch (error: any) {
                this.error = error.message || `Failed to add tracking event to shipment ${shipmentId}`
                console.error(`Error adding tracking event to shipment ${shipmentId}:`, error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async fetchStats() {
            try {
                const { data } = await useFetch('/api/shipments/stats')
                this.stats = data.value
            } catch (error: any) {
                console.error('Error fetching shipment stats:', error)
            }
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