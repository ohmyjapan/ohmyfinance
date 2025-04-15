// utils/excel-processor.js
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import fs from 'fs/promises';

/**
 * Process Excel file using a child process to avoid ESM issues
 * @param {string} filePath Path to the Excel file
 * @param {string} outputDir Directory to save the processed JSON
 * @returns {Promise<string>} Path to the processed JSON file
 */
export async function processExcelFile(filePath, outputDir) {
    try {
        // Create the directories if they don't exist
        await fs.mkdir(path.dirname(outputDir), { recursive: true });

        // Create temp script path
        const fileName = path.basename(filePath);
        const scriptPath = path.join(process.cwd(), 'temp-excel-script.cjs');
        const outputPath = path.join(outputDir, `${path.basename(fileName, path.extname(fileName))}.json`);

        // Create the CommonJS script content
        const scriptContent = `
      const XLSX = require('xlsx');
      const fs = require('fs');
      const path = require('path');
      
      try {
        // Read the Excel file
        const workbook = XLSX.readFile('${filePath.replace(/\\/g, '\\\\')}', {
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
        writeFileSync(scriptPath, scriptContent, 'utf8');

        // Execute the script with a child process
        return new Promise((resolve, reject) => {
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
                    unlinkSync(scriptPath);
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
    } catch (error) {
        console.error('Excel processing error:', error);
        throw error;
    }
}