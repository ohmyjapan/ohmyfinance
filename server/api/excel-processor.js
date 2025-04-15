// server/api/excel-processor.js

import { defineEventHandler, readMultipartFormData, createError } from 'h3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Safe way to get current directory with ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

export default defineEventHandler(async (event) => {
    try {
        // Handle form data upload
        const formData = await readMultipartFormData(event);

        if (!formData || formData.length === 0) {
            throw createError({
                statusCode: 400,
                statusMessage: 'No file provided'
            });
        }

        // Get the uploaded file
        const file = formData[0];
        const fileExt = path.extname(file.filename).toLowerCase();

        // Validate file type
        if (!['.xlsx', '.xls', '.csv'].includes(fileExt)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid file type. Only Excel and CSV files are supported.'
            });
        }

        // Ensure directories exist
        const downloadDir = path.join(rootDir, 'server/data/download');
        const processedDir = path.join(rootDir, 'server/data/processed');

        await fs.mkdir(downloadDir, { recursive: true });
        await fs.mkdir(processedDir, { recursive: true });

        // Save the file
        const timestamp = Date.now();
        const safeFilename = `${timestamp}-${file.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = path.join(downloadDir, safeFilename);

        await fs.writeFile(filePath, file.data);

        // Process the file using the global helper function from our patch
        // This avoids ESM loading issues by using a child process
        let processedFilePath = null;
        let processedData = null;

        if (fileExt === '.xlsx' || fileExt === '.xls') {
            processedFilePath = await global.processExcelWithChildProcess(filePath, processedDir);

            if (processedFilePath) {
                const jsonContent = await fs.readFile(processedFilePath, 'utf8');
                processedData = JSON.parse(jsonContent);
            }
        } else if (fileExt === '.csv') {
            // For CSV files, we can process them directly
            const csvContent = await fs.readFile(filePath, 'utf8');

            // Simple CSV parsing (in a real app, use a dedicated CSV parser)
            const lines = csvContent.split('\n');
            const headers = lines[0].split(',').map(h => h.trim());

            const data = [];
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;

                const values = lines[i].split(',');
                const entry = {};

                headers.forEach((header, index) => {
                    entry[header] = values[index]?.trim() || '';
                });

                data.push(entry);
            }

            processedData = { data };

            // Save processed CSV data
            processedFilePath = path.join(processedDir, `${path.basename(safeFilename, fileExt)}.json`);
            await fs.writeFile(processedFilePath, JSON.stringify(processedData, null, 2));
        }

        return {
            success: true,
            originalName: file.filename,
            savedPath: filePath,
            processedPath: processedFilePath,
            data: processedData
        };
    } catch (error) {
        console.error('File processing error:', error);

        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Failed to process file'
        });
    }
});