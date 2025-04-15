// server/api/upload.js
import { defineEventHandler, readMultipartFormData } from 'h3';
import path from 'path';
import fs from 'fs/promises';
import { processExcelFile } from '../../utils/excel-processor';

export default defineEventHandler(async (event) => {
    try {
        // Parse multipart form data (file upload)
        const formData = await readMultipartFormData(event);

        if (!formData || formData.length === 0) {
            return {
                success: false,
                error: 'No files uploaded'
            };
        }

        // Get the uploaded file
        const file = formData[0];

        // Create necessary directories
        const downloadDir = path.join(process.cwd(), 'server', 'data', 'download');
        const processedDir = path.join(process.cwd(), 'server', 'data', 'processed');

        await fs.mkdir(downloadDir, { recursive: true });
        await fs.mkdir(processedDir, { recursive: true });

        // Generate a unique filename
        const timestamp = Date.now();
        const safeName = `${timestamp}-${file.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = path.join(downloadDir, safeName);

        // Save the uploaded file
        await fs.writeFile(filePath, file.data);

        // Process the file if it's an Excel file
        let processedFilePath = null;
        const fileExt = path.extname(file.filename).toLowerCase();

        if (fileExt === '.xlsx' || fileExt === '.xls') {
            // Process the Excel file using a child process to avoid ESM issues
            try {
                processedFilePath = await processExcelFile(filePath, processedDir);
            } catch (error) {
                console.error('Excel processing error:', error);
            }
        }

        return {
            success: true,
            originalName: file.filename,
            savedAs: safeName,
            path: filePath,
            processedPath: processedFilePath
        };
    } catch (error) {
        console.error('File upload error:', error);
        return {
            success: false,
            error: error.message
        };
    }
});