/**
 * Setup script to prepare the environment for the application
 * This is run during npm install via the postinstall script
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('📦 Setting up environment...');

// Create necessary directories
const dirs = [
    path.join(process.cwd(), 'server/data'),
    path.join(process.cwd(), 'server/data/download'),
    path.join(process.cwd(), 'server/data/processed'),
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), 'uploads/transactions'),
    path.join(process.cwd(), 'uploads/receipts')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        console.log(`📁 Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Check for required packages
const requiredPackages = ['xlsx', 'papaparse', 'uuid'];
let missingPackages = [];

requiredPackages.forEach(pkg => {
    try {
        require.resolve(pkg);
        console.log(`✅ Package ${pkg} is installed`);
    } catch (e) {
        console.log(`❌ Package ${pkg} is missing`);
        missingPackages.push(pkg);
    }
});

// Install any missing packages
if (missingPackages.length > 0) {
    console.log(`🔧 Installing missing packages: ${missingPackages.join(', ')}`);
    try {
        execSync(`npm install ${missingPackages.join(' ')}`, { stdio: 'inherit' });
        console.log('✅ Missing packages installed successfully');
    } catch (error) {
        console.error('❌ Failed to install missing packages:', error.message);
    }
}

// Create a CommonJS wrapper for XLSX to avoid ESM issues
const xlsxWrapperDir = path.join(process.cwd(), 'node_modules', '.cjs-wrappers');
const xlsxWrapperPath = path.join(xlsxWrapperDir, 'xlsx.cjs');

if (!fs.existsSync(xlsxWrapperDir)) {
    fs.mkdirSync(xlsxWrapperDir, { recursive: true });
}

fs.writeFileSync(xlsxWrapperPath, `
const XLSX = require('xlsx');
module.exports = XLSX;
`);

console.log('✅ Created CommonJS wrapper for XLSX');

console.log('✅ Setup complete! You can now start the application with: npm run dev');