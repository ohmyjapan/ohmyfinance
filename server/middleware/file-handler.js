// server/middleware/file-handler.js
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { defineEventHandler, readBody } from 'h3';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export default defineEventHandler(async (event) => {
    // Only handle specific routes
    if (!event.path || !event.path.startsWith('/api/files')) {
        return;
    }

    // Create required directories
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const processedDir = path.join(uploadsDir, 'processed');

    try {
        await mkdir(uploadsDir, { recursive: true });
        await mkdir(processedDir, { recursive: true });
    } catch (error) {
        console.error('Error creating directories:', error);
    }

    // For operations that would have ESM issues, use child process
    if (event.path === '/api/files/process-excel') {
        const body = await readBody(event);

        if (!body.filepath) {
            return { error: 'No file path provided' };
        }

        try {
            // Use CommonJS via child process to avoid ESM path issues
            const scriptContent = `
        const XLSX = require('xlsx');
        const fs = require('fs');
        const path = require('path');
        
        try {
          const workbook = XLSX.readFile('${body.filepath.replace(/\\/g, '\\\\')}', {
            cellDates: true,
            cellNF: true,
            cellStyles: true
          });
          
          // Process workbook
          const result = {};
          workbook.SheetNames.forEach(name => {
            result[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name]);
          });
          
          fs.writeFileSync('${path.join(processedDir, 'data.json').replace(/\\/g, '\\\\')}', 
                           JSON.stringify(result, null, 2));
          
          console.log("SUCCESS");
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      `;

            // Write script to temp file
            const tempScriptPath = path.join(process.cwd(), 'temp-script.cjs');
            await writeFile(tempScriptPath, scriptContent);

            // Execute as CommonJS
            const { stdout, stderr } = await execPromise(`node ${tempScriptPath}`);

            if (stderr) {
                console.error('Script error:', stderr);
                return { error: stderr };
            }

            return { success: true, output: stdout, resultPath: path.join(processedDir, 'data.json') };
        } catch (error) {
            console.error('Execution error:', error);
            return { error: error.message };
        }
    }
});