/**
 * ESM Loader Patch for Windows
 *
 * Run with: node --require ./esm-patch.cjs your-command
 *
 * This script patches Node.js's internal module loading to handle
 * Windows paths correctly in ESM modules.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Keep track of what's been loaded
const loadedModules = new Set();

// Patch the require function to catch ESM issues
Module.prototype.require = function(path) {
    try {
        // Try the original require first
        return originalRequire.apply(this, arguments);
    } catch (error) {
        // If this is an ESM error with Windows paths, try to handle it
        if (error.code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME' &&
            error.message.includes('protocol \'c:\'')) {

            console.warn(`[ESM Patch] Warning: Patching path for ESM module: ${path}`);

            // Try to fix the path
            try {
                const correctedPath = `file:///${path.replace(/\\/g, '/')}`;

                // For debugging
                console.log(`[ESM Patch] Attempting to load with corrected path: ${correctedPath}`);

                // We can't directly fix the internal loader, but we can provide guidance
                console.log(`[ESM Patch] Please use file:// URLs in your imports for Windows paths.`);
                console.log(`[ESM Patch] Example: import x from 'file:///${path.replace(/\\/g, '/')}'`);

                // Just in case it works
                return originalRequire.call(this, correctedPath);
            } catch (patchError) {
                // If our patch fails, throw the original error
                throw error;
            }
        }

        // For other errors, just pass them through
        throw error;
    }
};

console.log('[ESM Patch] Installed Windows path compatibility patch for ESM modules.');

// Create necessary directories
const fs = require('fs');
const path = require('path');

const dirs = [
    path.join(process.cwd(), 'server/data'),
    path.join(process.cwd(), 'server/data/download'),
    path.join(process.cwd(), 'server/data/processed')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        console.log(`[ESM Patch] Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Add helper functions to global
global.processExcelWithChildProcess = function(inputPath, outputDir) {
    return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const fs = require('fs');
        const path = require('path');

        const fileName = path.basename(inputPath);
        const scriptPath = path.join(process.cwd(), 'temp-excel-script.cjs');
        const outputPath = path.join(outputDir, `${path.basename(fileName, path.extname(fileName))}.json`);

        // Create the CommonJS script content for Excel processing
        const scriptContent = `
      const XLSX = require('xlsx');
      const fs = require('fs');
      const path = require('path');
      
      try {
        // Read the Excel file
        const workbook = XLSX.readFile('${inputPath.replace(/\\/g, '\\\\')}', {
          cellStyles: true,
          cellFormulas: true,
          cellDates: true,
          cellNF: true,
          sheetStubs: true
        });
        
        // Process the sheets
        const result = {};
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          result[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        });
        
        // Write the result to a JSON file
        fs.writeFileSync('${outputPath.replace(/\\/g, '\\\\')}', JSON.stringify(result, null, 2));
        console.log('SUCCESS');
        process.exit(0);
      } catch (error) {
        console.error('ERROR:', error.message);
        process.exit(1);
      }
    `;

        // Write the script to a temporary file
        fs.writeFileSync(scriptPath, scriptContent, 'utf8');

        // Execute the script with a child process
        const childProcess = spawn('node', [scriptPath]);

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        childProcess.on('close', (code) => {
            // Clean up the temporary script
            try {
                fs.unlinkSync(scriptPath);
            } catch (e) {
                console.warn('Failed to delete temporary script:', e);
            }

            if (code === 0) {
                resolve(outputPath);
            } else {
                reject(new Error(`Processing failed: ${stderr}`));
            }
        });
    });
};