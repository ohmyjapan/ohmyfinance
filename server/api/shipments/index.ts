import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { v4 as uuidv4 } from 'uuid'

// In a real app, you would use a database
// These are simple in-memory stores that would be shared with other handlers
let shipments = []
let transactions = []

/**
 * Handles shipment operations
 * GET, POST /api/shipments
 */
export default defineEventHandler(async (event) => {
    const method = event.method

    // GET - List shipments
    if (method === 'GET') {
        const query = getQuery(event)

        // Apply filters if provided
        let filteredShipments = [...shipments]

        if (query.status) {
            filteredShipments = filteredShipments.filter(s =>
                s.status === query.status
            )
        }

        if (query.carrier) {
            filteredShipments = filteredShipments.filter(s =>
                s.carrier === query.carrier
            )
        }

        if (query.dateFrom) {
            const fromDate = new Date(query.dateFrom as string)
            filteredShipments = filteredShipments.filter(s =>
                new Date(s.createdAt) >= fromDate
            )
        }

        if (query.dateTo) {
            const toDate = new Date(query.dateTo as string)
            toDate.setHours(23, 59, 59, 999) // End of day
            filteredShipments = filteredShipments.filter(s =>
                new Date(s.createdAt) <= toDate
            )
        }

        if (query.deliveryWindow) {
            const now = new Date()

            if (query.deliveryWindow === 'today') {
                filteredShipments = filteredShipments.filter(s => {
                    const etaDate = new Date(s.estimatedDelivery)
                    return etaDate.toDateString() === now.toDateString()
                })
            } else if (query.deliveryWindow === 'tomorrow') {
                const tomorrow = new Date(now)
                tomorrow.setDate(now.getDate() + 1)

                filteredShipments = filteredShipments.filter(s => {
                    const etaDate = new Date(s.estimatedDelivery)
                    return etaDate.toDateString() === tomorrow.toDateString()
                })
            } else if (query.deliveryWindow === 'this_week') {
                const thisWeekEnd = new Date(now)
                thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()))

                filteredShipments = filteredShipments.filter(s => {
                    const etaDate = new Date(s.estimatedDelivery)
                    return etaDate >= now && etaDate <= thisWeekEnd
                })
            } else if (query.deliveryWindow === 'next_week') {
                const thisWeekEnd = new Date(now)
                thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()))

                const nextWeekStart = new Date(thisWeekEnd)
                nextWeekStart.setDate(thisWeekEnd.getDate() + 1)

                const nextWeekEnd = new Date(nextWeekStart)
                nextWeekEnd.setDate(nextWeekStart.getDate() + 6)

                filteredShipments = filteredShipments.filter(s => {
                    const etaDate = new Date(s.estimatedDelivery)
                    return etaDate >= nextWeekStart && etaDate <= nextWeekEnd
                })
            } else if (query.deliveryWindow === 'overdue') {
                filteredShipments = filteredShipments.filter(s => {
                    const etaDate = new Date(s.estimatedDelivery)
                    return etaDate < now && s.status !== 'delivered'
                })
            }
        }

        if (query.country) {
            filteredShipments = filteredShipments.filter(s =>
                s.destination.country === query.country
            )
        }

        if (query.search) {
            const search = (query.search as string).toLowerCase()
            filteredShipments = filteredShipments.filter(s =>
                s.id.toLowerCase().includes(search) ||
                s.trackingNumber.toLowerCase().includes(search) ||
                s.customer.name.toLowerCase().includes(search) ||
                s.orderId.toLowerCase().includes(search)
            )
        }

        // Pagination
        const page = parseInt(query.page as string) || 1
        const limit = parseInt(query.limit as string) || 10
        const startIndex = (page - 1) * limit
        const endIndex = page * limit

        // Calculate stats
        const total = filteredShipments.length
        const pending = filteredShipments.filter(s => s.status === 'pending').length
        const inTransit = filteredShipments.filter(s => s.status === 'in_transit').length
        const delivered = filteredShipments.filter(s => s.status === 'delivered').length
        const delayed = filteredShipments.filter(s =>
            s.status === 'delayed' || s.status === 'exception'
        ).length

        // Return paginated results with metadata
        return {
            shipments: filteredShipments.slice(startIndex, endIndex),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            },
            stats: {
                total,
                pending,
                inTransit,
                delivered,
                delayed
            }
        }
    }

    // POST - Create a new shipment
    if (method === 'POST') {
        const body = await readBody(event)

        // Validate required fields
        if (!body.trackingNumber || !body.carrier) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'Tracking number and carrier are required fields'
            })
        }

        // Create new shipment
        const newShipment = {
            id: `SHP-${uuidv4().substring(0, 8)}`,
            trackingNumber: body.trackingNumber,
            carrier: body.carrier,
            status: body.status || 'pending',
            createdAt: new Date().toISOString(),
            estimatedDelivery: body.estimatedDelivery || null,
            orderId: body.orderId || null,
            transactionId: body.transactionId || null,
            customer: body.customer || {
                name: 'Customer',
                email: null
            },
            destination: body.destination || {
                address: null,
                city: null,
                state: null,
                postalCode: null,
                country: null
            },
            serviceType: body.serviceType || 'Standard',
            packageType: body.packageType || 'Package',
            weight: body.weight || null,
            weightUnit: body.weightUnit || 'kg',
            dimensions: body.dimensions || null,
            insurance: body.insurance || null,
            signatureRequired: body.signatureRequired || false,
            events: [
                {
                    type: 'created',
                    title: 'Shipment Created',
                    timestamp: new Date().toISOString(),
                    description: 'Shipping label created',
                    location: 'Warehouse'
                }
            ],
            updatedAt: new Date().toISOString()
        }

        // Add to the collection
        shipments.push(newShipment)

        // If this shipment is associated with a transaction, update the transaction
        if (newShipment.transactionId) {
            const transactionIndex = transactions.findIndex(t => t.id === newShipment.transactionId)

            if (transactionIndex !== -1) {
                const transaction = transactions[transactionIndex]

                // Update transaction with shipment reference
                const updatedTransaction = {
                    ...transaction,
                    shipment: {
                        id: newShipment.id,
                        trackingNumber: newShipment.trackingNumber,
                        carrier: newShipment.carrier,
                        status: newShipment.status,
                        estimatedDelivery: newShipment.estimatedDelivery
                    },
                    updatedAt: new Date().toISOString()
                }

                // Add a timeline event for the shipment
                if (!updatedTransaction.timeline) {
                    updatedTransaction.timeline = []
                }

                updatedTransaction.timeline.unshift({
                    type: 'shipment_created',
                    title: 'Shipment Created',
                    timestamp: new Date().toISOString(),
                    description: `Shipment created with tracking number ${newShipment.trackingNumber}`
                })

                // Update transaction in the collection
                transactions[transactionIndex] = updatedTransaction
            }
        }

        return {
            shipment: newShipment,
            message: 'Shipment created successfully'
        }
    }

    // Method not allowed
    throw createError({
        statusCode: 405,
        statusMessage: 'Method Not Allowed',
        message: `Method ${method} not allowed for this endpoint`
    })
})