// server/plugins/mongodb.ts
// Lazy-load MongoDB connection to avoid build issues
export default defineNitroPlugin(async (nitroApp) => {
  // Only connect in production or when explicitly requested
  // In development, connection happens on first API request
  if (process.env.NODE_ENV === 'production') {
    try {
      const { connectDB } = await import('../config/database')
      await connectDB()
      console.log('MongoDB plugin initialized')
    } catch (error) {
      console.error('Failed to initialize MongoDB plugin:', error)
    }
  }
})
