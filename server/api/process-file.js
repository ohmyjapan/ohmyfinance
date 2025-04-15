// server/api/process-file.js
import { defineEventHandler, readBody } from 'h3';
import path from 'path';
import fs from 'fs/promises';
import { processExcelFile } from '../../utils/excel-processor';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);

        if (!body.filePath) {
            return {
                success: false,
                error: 'No file path provided'
            };
        }

        // Create processed directory
        const processedDir = path.join(process.cwd(), 'server', 'data', 'processed');
        await fs.mkdir(processedDir, { recursive: true });

        // Check if file exists
        try {
            await fs.access(body.filePath);
        } catch (e) {
            return {
                success: false,
                error: 'File not found'
            };
        }

        // Process the Excel file using a child process to avoid ESM issues
        const processedFilePath = await processExcelFile(body.filePath, processedDir);

        return {
            success: true,
            processedPath: processedFilePath
        };
    } catch (error) {
        console.error('File processing error:', error);
        return {
            success: false,
            error: error.message
        };
    }
});