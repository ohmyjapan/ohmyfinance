import { defineEventHandler, readBody, createError } from 'h3';
import path from 'path';
import fs from 'fs/promises';
import { processExcelFile } from '../../../utils/excel-processor';
import { toFileUrl } from '../../../utils/path';

/**
 * Handles transaction file processing and imports data to the system
 */
export default defineEventHandler(async (event) => {
    try {
        // Parse request body
        const body = await readBody(event);

        if (!body.filePath) {
            throw createError({
                statusCode: 400,
                statusMessage: 'File path is required'
            });
        }

        // Get file information
        const filePath = body.filePath;
        const fileExt = path.extname(filePath).toLowerCase();

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch (error) {
            throw createError({
                statusCode: 404,
                statusMessage: 'File not found'
            });
        }

        // Process based on file type
        const processedDir = path.join(process.cwd(), 'uploads', 'processed');
        let result;

        if (fileExt === '.xlsx' || fileExt === '.xls') {
            // Use our Excel processor to avoid ESM issues
            const processedPath = await processExcelFile(filePath, processedDir);

            // Read processed JSON file
            const processedData = await fs.readFile(processedPath, 'utf8');
            result = JSON.parse(processedData);
        }
        else if (fileExt === '.csv') {
            // For CSV, we can use a simple file read
            // In a real app, you'd use a CSV parser library
            const fileContent = await fs.readFile(filePath, 'utf8');

            // Simple CSV parsing for demonstration
            const lines = fileContent.split('\\n');
            const headers = lines[0].split(',');

            const data = [];
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;

                const values = lines[i].split(',');
                const entry = {};

                headers.forEach((header, index) => {
                    entry[header.trim()] = values[index]?.trim() || '';
                });

                data.push(entry);
            }

            result = { data };
        }
        else {
            throw createError({
                statusCode: 400,
                statusMessage: 'Unsupported file type'
            });
        }

        // Map to transaction data
        const mappedData = result.data?.map((row, index) => {
            return {
                id: `TRX-${Date.now()}-${index}`,
                ...mapFields(row, body.mappings || {})
            };
        }) || [];

        return {
            success: true,
            data: mappedData,
            totalRecords: mappedData.length
        };
    } catch (error) {
        console.error('Transaction processing error:', error);

        throw createError({
            statusCode: error.statusCode || 500,
            statusMessage: error.statusMessage || 'Failed to process transaction file'
        });
    }
});

/**
 * Maps fields from source data to target schema based on provided mappings
 */
function mapFields(sourceData, mappings) {
    const result = {
        createdAt: new Date().toISOString(),
        status: 'pending'
    };

    Object.entries(mappings).forEach(([sourceField, targetConfig]) => {
        if (typeof targetConfig === 'string') {
            // Simple mapping
            result[targetConfig] = sourceData[sourceField];
        }
        else if (targetConfig && typeof targetConfig === 'object') {
            // Complex mapping with formatting
            const { field, format } = targetConfig;
            if (!field) return;

            let value = sourceData[sourceField];

            // Apply formatting
            if (format === 'date' || format === 'date_iso') {
                try {
                    value = new Date(value).toISOString();
                } catch (e) {
                    // Keep original value if date parsing fails
                }
            }
            else if (format === 'currency_usd' && !isNaN(parseFloat(value))) {
                value = parseFloat(value);
            }

            result[field] = value;
        }
    });

    return result;
}