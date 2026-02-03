// server/plugins/mongodb.ts
// Initialize MongoDB connection on server startup
export default defineNitroPlugin(async (nitroApp) => {
  try {
    const { connectDB } = await import('../config/database')
    await connectDB()
    console.log('MongoDB plugin initialized')
  } catch (error) {
    console.error('Failed to initialize MongoDB plugin:', error)
    // Don't throw - allow server to start even if MongoDB is unavailable
    // API endpoints will handle connection errors gracefully
  }
})
