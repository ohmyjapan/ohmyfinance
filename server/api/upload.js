// server/api/upload.js
import { defineEventHandler, readMultipartFormData, createError } from 'h3';
import path from 'path';
import fs from 'fs/promises';
import { processExcelFile } from '../../utils/excel-processor';
import { requireAuth } from '../middleware/auth';
import { sweepOlderThan } from '../utils/uploadRetention';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default defineEventHandler(async (event) => {
    // S17: a login is required; the saved input and the processed output live for this request only.
    requireAuth(event);
    let filePath = null;
    let processedFilePath = null;
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

        // Server-side file size limit: 10MB
        if (file.data && file.data.length > MAX_FILE_SIZE) {
            throw createError({
                statusCode: 413,
                statusMessage: 'ファイルサイズが大きすぎます (File too large)',
                message: `File size ${(file.data.length / 1024 / 1024).toFixed(1)}MB exceeds 10MB limit`
            });
        }

        // Create necessary directories
        const downloadDir = path.join(process.cwd(), 'server', 'data', 'download');
        const processedDir = path.join(process.cwd(), 'server', 'data', 'processed');

        await fs.mkdir(downloadDir, { recursive: true });
        await fs.mkdir(processedDir, { recursive: true });
        await sweepOlderThan(downloadDir);
        await sweepOlderThan(processedDir);

        // Generate a unique filename
        const timestamp = Date.now();
        const safeName = `${timestamp}-${file.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        filePath = path.join(downloadDir, safeName);

        // Save the uploaded file
        await fs.writeFile(filePath, file.data);

        // Process the file if it's an Excel file
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
        if (error && error.statusCode) throw error;
        console.error('File upload error:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        // Request-lifetime storage: the input and the processed output leave the disk once the response is built.
        for (const target of [filePath, processedFilePath]) if (target) await fs.unlink(target).catch(() => {});
    }
});
