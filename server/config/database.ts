import mongoose from 'mongoose'

let isConnected = false
let connectionPromise: Promise<void> | null = null
let mongoServer: any = null

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const MAX_RETRIES = 5
const RETRY_DELAY_MS = 3000

// Get MongoDB URI - retries local MongoDB before falling back to in-memory
const getMongoUri = async (): Promise<string> => {
  const envUri = process.env.MONGO_URI

  if (envUri && !envUri.includes('localhost:27017')) {
    return envUri
  }

  if (envUri) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const testConnection = await mongoose.createConnection(envUri).asPromise()
        await testConnection.close()
        console.log('Using local MongoDB at', envUri)
        return envUri
      } catch {
        console.warn(`[MongoDB] Connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
      }
    }
    console.error('[MongoDB] WARNING: All connection attempts failed — falling back to in-memory DB. Auth and data will NOT persist!')
  }

  // Fall back to in-memory MongoDB
  const { MongoMemoryServer } = await import('mongodb-memory-server')

  if (!mongoServer) {
    mongoServer = await MongoMemoryServer.create({
      instance: {
        dbName: 'ohmyfinance'
      }
    })
    console.error('[MongoDB] In-memory server started — THIS IS NOT PRODUCTION-SAFE')
  }

  return mongoServer.getUri()
}

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
      const uri = await getMongoUri()
      await mongoose.connect(uri)
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
  name: mongoose.connection.name,
  isMemoryServer: !!mongoServer
})

// Stop memory server on shutdown
export const stopMemoryServer = async () => {
  if (mongoServer) {
    await mongoServer.stop()
    mongoServer = null
    console.log('In-memory MongoDB server stopped')
  }
}

export default connectDB
