// server/utils/database.ts

// You can replace this with your preferred database library
// This example uses a simple in-memory database for demonstration
// In a real app, you'd use MongoDB, PostgreSQL, MySQL, etc.

import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'

// Initialize storage
const storage = createStorage({
    driver: memoryDriver()
})

// Initialize collections if they don't exist
async function initializeCollections() {
    const collections = ['transactions', 'receipts', 'shipments', 'users']

    for (const collection of collections) {
        if (!await storage.hasItem(collection)) {
            await storage.setItem(collection, [])
        }
    }
}

// Initialize on server startup
initializeCollections()

// Generic CRUD operations
export async function findAll(collection: string) {
    return storage.getItem(collection) || []
}

export async function findById(collection: string, id: string) {
    const items = await storage.getItem(collection) || []
    return items.find(item => item.id === id) || null
}

export async function findBy(collection: string, filters: Record<string, any>) {
    const items = await storage.getItem(collection) || []

    return items.filter(item => {
        for (const [key, value] of Object.entries(filters)) {
            if (item[key] !== value) {
                return false
            }
        }
        return true
    })
}

export async function create(collection: string, data: any) {
    const items = await storage.getItem(collection) || []
    items.push(data)
    await storage.setItem(collection, items)
    return data
}

export async function update(collection: string, id: string, data: any) {
    const items = await storage.getItem(collection) || []
    const index = items.findIndex(item => item.id === id)

    if (index === -1) {
        throw new Error(`Item with id ${id} not found in ${collection}`)
    }

    const updatedItem = { ...items[index], ...data }
    items[index] = updatedItem
    await storage.setItem(collection, items)
    return updatedItem
}

export async function remove(collection: string, id: string) {
    const items = await storage.getItem(collection) || []
    const newItems = items.filter(item => item.id !== id)
    await storage.setItem(collection, newItems)
    return { deleted: items.length - newItems.length }
}

// Function to simulate database connection in development
export function getDbStatus() {
    return {
        connected: true,
        collections: ['transactions', 'receipts', 'shipments', 'users'],
        driver: 'memory'
    }
}

// Export the storage instance for direct access if needed
export { storage }