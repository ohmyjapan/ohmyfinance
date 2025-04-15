import { defineEventHandler, readBody, createError } from 'h3';
import path from 'path';
import fs from 'fs/promises';
import { toFileUrl } from '../../../utils/path';

/**
 * Matches receipt with transaction data
 */
export default defineEventHandler(async (event) => {
    try {
        // Parse request body
        const body = await readBody(event);

        if (!body.receiptId || !body.transactionId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Receipt ID and Transaction ID are required'
            });
        }

        // In a real application, this would interact with a database
        // For now, we'll simulate successful matching

        // Update the receipt status (in a real app, this would be a database update)
        const receipt = {
            id: body.receiptId,
            status: 'matched',
            transactionId: body.transactionId,
            updatedAt: new Date().toISOString()
        };

        // Log the match for demonstration
        const logsDir = path.join(process.cwd(), 'logs');
        await fs.mkdir(logsDir, { recursive: true });

        const logFile = path.join(logsDir, 'receipt-matches.log');
        const logEntry = `${new Date().toISOString()} - Matched receipt ${body.receiptId} with transaction ${body.transactionId}\\n`;

        try {
            await fs.appendFile(logFile, logEntry);
        } catch (error) {
            console.warn('Failed to write to log file:', error);
        }

        return {
            success: true,
            receipt
        };
    } catch (error) {
        console.error('Receipt matching error:', error);

        throw createError({
            statusCode: error.statusCode || 500,
            statusMessage: error.statusMessage || 'Failed to match receipt with transaction'
        });
    }
});