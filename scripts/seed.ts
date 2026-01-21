// scripts/seed.ts
// Run with: npx tsx scripts/seed.ts
import mongoose from 'mongoose'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ohmyfinance'

// Import models after connection
async function seed() {
  try {
    console.log('Connecting to MongoDB...')
    await mongoose.connect(MONGO_URI)
    console.log('Connected to MongoDB')

    // Import models
    const Transaction = (await import('../server/models/Transaction')).default
    const Receipt = (await import('../server/models/Receipt')).default
    const Shipment = (await import('../server/models/Shipment')).default
    const Customer = (await import('../server/models/Customer')).default
    const DataSource = (await import('../server/models/DataSource')).default

    // Clear existing data (optional - comment out to preserve data)
    console.log('Clearing existing data...')
    await Transaction.deleteMany({})
    await Receipt.deleteMany({})
    await Shipment.deleteMany({})
    await Customer.deleteMany({})

    // Seed customers
    console.log('Seeding customers...')
    const customers = await Customer.insertMany([
      {
        name: 'John Anderson',
        email: 'john.anderson@example.com',
        phone: '+1-555-0101',
        company: 'Anderson Corp'
      },
      {
        name: 'Sarah Thompson',
        email: 'sarah.thompson@example.com',
        phone: '+1-555-0102',
        company: 'Thompson Industries'
      },
      {
        name: 'Michael Chen',
        email: 'michael.chen@example.com',
        phone: '+1-555-0103',
        company: 'Chen Enterprises'
      }
    ])
    console.log(`Created ${customers.length} customers`)

    // Seed data sources if not exists
    const existingSources = await DataSource.countDocuments()
    if (existingSources === 0) {
      console.log('Seeding data sources...')
      await DataSource.insertMany([
        { name: 'Credit Card', type: 'credit_card', isActive: true },
        { name: 'Payment Gateway', type: 'payment_gateway', isActive: true },
        { name: 'Overseas Market', type: 'overseas', isActive: true },
        { name: 'Manual Entry', type: 'manual', isActive: true }
      ])
    }

    // Seed transactions
    console.log('Seeding transactions...')
    const transactions = await Transaction.insertMany([
      {
        reference: 'TXN-2025-001',
        date: new Date('2025-01-15'),
        amount: 1459.00,
        currency: 'JPY',
        status: 'completed',
        source: 'credit_card',
        customer: {
          name: 'John Anderson',
          email: 'john.anderson@example.com'
        },
        paymentMethod: {
          type: 'credit_card',
          last4: '4242',
          brand: 'VISA'
        },
        items: [
          { name: 'Premium Subscription', quantity: 1, price: 1199, total: 1199 },
          { name: 'Add-on Package', quantity: 1, price: 260, total: 260 }
        ],
        timeline: [
          { type: 'completed', title: 'Transaction Completed', timestamp: new Date('2025-01-15T15:32:00Z') },
          { type: 'created', title: 'Order Placed', timestamp: new Date('2025-01-15T15:28:00Z') }
        ]
      },
      {
        reference: 'TXN-2025-002',
        date: new Date('2025-01-14'),
        amount: 899.50,
        currency: 'JPY',
        status: 'pending',
        source: 'payment_gateway',
        customer: {
          name: 'Sarah Thompson',
          email: 'sarah.thompson@example.com'
        },
        items: [
          { name: 'Business Plan', quantity: 1, price: 899.50, total: 899.50 }
        ],
        timeline: [
          { type: 'created', title: 'Order Placed', timestamp: new Date('2025-01-14T12:30:00Z') }
        ]
      },
      {
        reference: 'TXN-2025-003',
        date: new Date('2025-01-13'),
        amount: 2500.00,
        currency: 'JPY',
        status: 'processing',
        source: 'overseas',
        customer: {
          name: 'Michael Chen',
          email: 'michael.chen@example.com'
        },
        items: [
          { name: 'Enterprise License', quantity: 1, price: 2500, total: 2500 }
        ],
        timeline: [
          { type: 'processing', title: 'Payment Processing', timestamp: new Date('2025-01-13T10:00:00Z') },
          { type: 'created', title: 'Order Placed', timestamp: new Date('2025-01-13T09:45:00Z') }
        ]
      }
    ])
    console.log(`Created ${transactions.length} transactions`)

    // Seed receipts
    console.log('Seeding receipts...')
    const receipts = await Receipt.insertMany([
      {
        filename: 'receipt_001.pdf',
        originalFilename: 'invoice_jan15.pdf',
        size: 438272,
        mimeType: 'application/pdf',
        status: 'matched',
        transactionId: transactions[0]._id,
        amount: 1459.00,
        merchant: 'Tech Services Inc.',
        receiptDate: new Date('2025-01-15'),
        uploadDate: new Date('2025-01-15T16:00:00Z')
      },
      {
        filename: 'receipt_002.jpg',
        originalFilename: 'store_receipt.jpg',
        size: 1258291,
        mimeType: 'image/jpeg',
        status: 'unmatched',
        amount: 299.00,
        merchant: 'ElectroMart',
        receiptDate: new Date('2025-01-14'),
        uploadDate: new Date('2025-01-14T10:00:00Z')
      }
    ])
    console.log(`Created ${receipts.length} receipts`)

    // Update transaction with receipt reference
    await Transaction.findByIdAndUpdate(transactions[0]._id, {
      receipt: {
        receiptId: receipts[0]._id,
        filename: receipts[0].originalFilename,
        size: receipts[0].size,
        amount: receipts[0].amount,
        merchant: receipts[0].merchant
      }
    })

    // Seed shipments
    console.log('Seeding shipments...')
    const shipments = await Shipment.insertMany([
      {
        trackingNumber: 'FEDEX-123456789',
        carrier: 'FedEx',
        status: 'in_transit',
        shippingDate: new Date('2025-01-15'),
        estimatedDelivery: new Date('2025-01-20'),
        transactionIds: [transactions[0]._id],
        shippingAddress: {
          name: 'John Anderson',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US'
        },
        events: [
          { type: 'in_transit', title: 'In Transit', timestamp: new Date('2025-01-16T08:00:00Z'), location: 'Distribution Center' },
          { type: 'shipped', title: 'Shipped', timestamp: new Date('2025-01-15T14:00:00Z') },
          { type: 'created', title: 'Shipment Created', timestamp: new Date('2025-01-15T12:00:00Z') }
        ]
      },
      {
        trackingNumber: 'UPS-987654321',
        carrier: 'UPS',
        status: 'delivered',
        shippingDate: new Date('2025-01-10'),
        deliveryDate: new Date('2025-01-14'),
        transactionIds: [transactions[1]._id],
        shippingAddress: {
          name: 'Sarah Thompson',
          line1: '456 Park Ave',
          city: 'Chicago',
          state: 'IL',
          postalCode: '60601',
          country: 'US'
        },
        events: [
          { type: 'delivered', title: 'Delivered', timestamp: new Date('2025-01-14T15:30:00Z'), location: 'Front Door' },
          { type: 'out_for_delivery', title: 'Out for Delivery', timestamp: new Date('2025-01-14T08:00:00Z') },
          { type: 'in_transit', title: 'In Transit', timestamp: new Date('2025-01-12T10:00:00Z') },
          { type: 'created', title: 'Shipment Created', timestamp: new Date('2025-01-10T09:00:00Z') }
        ]
      }
    ])
    console.log(`Created ${shipments.length} shipments`)

    // Update transactions with shipment references
    await Transaction.findByIdAndUpdate(transactions[0]._id, {
      shipment: {
        shipmentId: shipments[0]._id,
        trackingNumber: shipments[0].trackingNumber,
        carrier: shipments[0].carrier,
        status: shipments[0].status
      }
    })

    console.log('\nSeeding completed successfully!')
    console.log('Summary:')
    console.log(`  - ${customers.length} customers`)
    console.log(`  - ${transactions.length} transactions`)
    console.log(`  - ${receipts.length} receipts`)
    console.log(`  - ${shipments.length} shipments`)

  } catch (error) {
    console.error('Seeding failed:', error)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('\nDisconnected from MongoDB')
  }
}

seed()
