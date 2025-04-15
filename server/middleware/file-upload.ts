import { defineEventHandler, readMultipartFormData, createError } from 'h3';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { processExcelFile } from '../../utils/excel-processor';

// Define allowed file types
const ALLOWED_TYPES = {
    csv: ['text/csv'],
    excel: [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    images: ['image/jpeg', 'image/png'],
    pdf: ['application/pdf']
};

export default defineEventHandler(async (event) => {
    try {
        // Only process POST requests to specific endpoints
        if (event.req.method !== 'POST') {
            return;
        }

        const url = event.req.url;
        if (!url || (!url.includes('/api/upload/transaction') &&
            !url.includes('/api/upload/receipt'))) {
            return;
        }

        // Parse the multipart form data
        const formData = await readMultipartFormData(event);
        if (!formData || formData.length === 0) {
            throw createError({
                statusCode: 400,
                statusMessage: 'No files were uploaded'
            });
        }

        // Create upload directories if they don't exist
        const uploadsDir = path.join(process.cwd(), 'uploads');
        const transactionsDir = path.join(uploadsDir, 'transactions');
        const receiptsDir = path.join(uploadsDir, 'receipts');
        const processedDir = path.join(uploadsDir, 'processed');

        await mkdir(uploadsDir, { recursive: true });
        await mkdir(transactionsDir, { recursive: true });
        await mkdir(receiptsDir, { recursive: true });
        await mkdir(processedDir, { recursive: true });

        // Process each uploaded file
        const uploadedFiles = [];

        for (const file of formData) {
            if (!file.filename) continue;

            // Validate file type
            const isValidType = Object.values(ALLOWED_TYPES).some(
                types => types.includes(file.type as string)
            );

            if (!isValidType) {
                throw createError({
                    statusCode: 400,
                    statusMessage: `Invalid file type: ${file.type}`
                });
            }

            // Determine target directory based on upload endpoint
            const targetDir = url.includes('/api/upload/transaction')
                ? transactionsDir
                : receiptsDir;

            // Create a safe filename
            const timestamp = Date.now();
            const safeFilename = `${timestamp}-${file.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const filePath = path.join(targetDir, safeFilename);

            // Save the file
            await writeFile(filePath, file.data);

            // Process Excel files
            let processedPath = null;
            if (ALLOWED_TYPES.excel.includes(file.type as string)) {
                try {
                    processedPath = await processExcelFile(filePath, processedDir);
                } catch (error) {
                    console.error('Error processing Excel file:', error);
                    // Continue with upload even if processing fails
                }
            }

            // Add file info to response
            uploadedFiles.push({
                originalName: file.filename,
                savedAs: safeFilename,
                path: filePath,
                processed: processedPath,
                size: file.data.length,
                type: file.type
            });
        }

        return {
            success: true,
            files: uploadedFiles
        };
    } catch (error) {
        console.error('File upload error:', error);

        throw createError({
            statusCode: error.statusCode || 500,
            statusMessage: error.statusMessage || 'File upload failed'
        });
    }
});