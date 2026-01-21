import mongoose from 'mongoose'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ohmyfinance'

let isConnected = false
let connectionPromise: Promise<void> | null = null

export const connectDB = async (): Promise<void> => {
  // Return existing promise if connection is in progress
  if (connectionPromise) {
    return connectionPromise
  }

  if (isConnected && mongoose.connection.readyState === 1) {
    return
  }

  connectionPromise = (async () => {
    try {
      await mongoose.connect(MONGO_URI)
      isConnected = true
      console.log('MongoDB connected successfully')

      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err)
        isConnected = false
      })

      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected')
        isConnected = false
        connectionPromise = null
      })

    } catch (error) {
      console.error('MongoDB connection failed:', error)
      isConnected = false
      connectionPromise = null
      throw error
    }
  })()

  return connectionPromise
}

// Ensure connection before database operations
export const ensureConnection = async (): Promise<void> => {
  if (!isConnected || mongoose.connection.readyState !== 1) {
    await connectDB()
  }
}

export const getConnectionStatus = () => ({
  isConnected,
  readyState: mongoose.connection.readyState,
  host: mongoose.connection.host,
  name: mongoose.connection.name
})

export default connectDB
