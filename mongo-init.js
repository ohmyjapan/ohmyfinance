// MongoDB initialization script
// This runs when the MongoDB container is first created

db = db.getSiblingDB('ohmyfinance');

// Create collections
db.createCollection('transactions');
db.createCollection('receipts');
db.createCollection('shipments');
db.createCollection('customers');
db.createCollection('suppliers');
db.createCollection('accountcategories');
db.createCollection('datasources');

// Create indexes for transactions
db.transactions.createIndex({ reference: 1 }, { unique: true });
db.transactions.createIndex({ date: -1 });
db.transactions.createIndex({ status: 1 });
db.transactions.createIndex({ source: 1 });
db.transactions.createIndex({ 'customer.email': 1 });
db.transactions.createIndex({ createdAt: -1 });

// Create indexes for receipts
db.receipts.createIndex({ filename: 1 }, { unique: true });
db.receipts.createIndex({ uploadDate: -1 });
db.receipts.createIndex({ status: 1 });
db.receipts.createIndex({ transactionId: 1 });

// Create indexes for shipments
db.shipments.createIndex({ trackingNumber: 1 });
db.shipments.createIndex({ status: 1 });
db.shipments.createIndex({ transactionIds: 1 });

// Seed default data sources
db.datasources.insertMany([
  {
    name: 'Credit Card',
    type: 'credit_card',
    description: 'Credit card transaction source',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Payment Gateway',
    type: 'payment_gateway',
    description: 'Online payment gateway transactions',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Overseas Market',
    type: 'overseas',
    description: 'International marketplace transactions',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Manual Entry',
    type: 'manual',
    description: 'Manually entered transactions',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

// Seed default account categories
db.accountcategories.insertMany([
  {
    name: '売上',
    code: 'REVENUE',
    type: 'income',
    description: 'Revenue accounts',
    isActive: true,
    order: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: '仕入',
    code: 'PURCHASE',
    type: 'expense',
    description: 'Purchase accounts',
    isActive: true,
    order: 2,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: '経費',
    code: 'EXPENSE',
    type: 'expense',
    description: 'General expense accounts',
    isActive: true,
    order: 3,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

print('Database initialized with collections and seed data');
