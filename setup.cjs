// setup.cjs
const fs = require('fs');
const path = require('path');

console.log('Setting up transaction middleware system...');

// Create necessary directories
const dirs = [
    path.join(process.cwd(), 'server/data/download'),
    path.join(process.cwd(), 'server/data/processed'),
    path.join(process.cwd(), 'uploads/transactions'),
    path.join(process.cwd(), 'uploads/receipts')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
    }
});

console.log('Setup complete!');