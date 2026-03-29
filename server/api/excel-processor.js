// server/api/excel-processor.js

import { defineEventHandler, readMultipartFormData, createError } from 'h3';
import fs from 'node:fs/promises';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';

/**
 * Detect if a buffer is Shift-JIS encoded.
 * Checks for common Shift-JIS byte patterns (half-width katakana, double-byte chars).
 * Falls back to UTF-8 if no Shift-JIS indicators found.
 */
function detectEncoding(buffer) {
  // Check for UTF-8 BOM
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf8';
  }

  let sjisScore = 0;
  let utf8Score = 0;
  const len = Math.min(buffer.length, 4096); // Check first 4KB

  for (let i = 0; i < len; i++) {
    const b = buffer[i];

    // Shift-JIS double-byte lead bytes: 0x81-0x9F, 0xE0-0xFC
    if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
      if (i + 1 < len) {
        const b2 = buffer[i + 1];
        // Valid Shift-JIS trail byte: 0x40-0x7E, 0x80-0xFC
        if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) {
          sjisScore += 2;
          i++; // skip trail byte
          continue;
        }
      }
    }

    // Half-width katakana (Shift-JIS): 0xA1-0xDF
    if (b >= 0xA1 && b <= 0xDF) {
      sjisScore++;
      continue;
    }

    // UTF-8 multi-byte sequences
    if (b >= 0xC0 && b <= 0xDF && i + 1 < len) {
      if ((buffer[i + 1] & 0xC0) === 0x80) { utf8Score++; i++; continue; }
    }
    if (b >= 0xE0 && b <= 0xEF && i + 2 < len) {
      if ((buffer[i + 1] & 0xC0) === 0x80 && (buffer[i + 2] & 0xC0) === 0x80) { utf8Score += 2; i += 2; continue; }
    }
  }

  return sjisScore > utf8Score ? 'Shift_JIS' : 'utf8';
}

// Use process.cwd() for Windows compatibility
const rootDir = process.cwd();

/**
 * Process Excel file using a child process to avoid ESM issues
 */
async function processExcelWithChildProcess(filePath, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });

    const fileName = path.basename(filePath);
    const scriptPath = path.join(rootDir, `temp-excel-proc-${Date.now()}.cjs`);
    const outputPath = path.join(outputDir, `${path.basename(fileName, path.extname(fileName))}.json`);

    const escapedFilePath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedOutputPath = outputPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // Script that converts Excel to JSON with proper headers
    const scriptContent = `
const XLSX = require('xlsx');
const fs = require('fs');

try {
    const workbook = XLSX.readFile('${escapedFilePath}', {
        cellStyles: true,
        cellFormulas: true,
        cellDates: true,
        cellNF: true,
        sheetStubs: true,
        raw: false // Get formatted values
    });

    // Get the first sheet (or all sheets)
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to JSON with headers
    const rawData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: false
    });

    if (rawData.length === 0) {
        fs.writeFileSync('${escapedOutputPath}', JSON.stringify({ headers: [], data: [] }));
        console.log('SUCCESS');
        process.exit(0);
    }

    // First row is headers
    const headers = rawData[0].map((h, i) => h ? String(h).trim() : 'Column' + (i + 1));

    // Convert remaining rows to objects
    const data = [];
    for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        // Skip completely empty rows
        if (!row || row.every(cell => cell === '' || cell === null || cell === undefined)) {
            continue;
        }

        const obj = {};
        headers.forEach((header, index) => {
            let value = row[index];
            // Handle dates
            if (value instanceof Date) {
                value = value.toISOString().split('T')[0];
            }
            obj[header] = value !== undefined && value !== null ? value : '';
        });
        data.push(obj);
    }

    const result = {
        headers: headers,
        data: data,
        sheetName: sheetName,
        totalSheets: workbook.SheetNames.length,
        allSheetNames: workbook.SheetNames
    };

    fs.writeFileSync('${escapedOutputPath}', JSON.stringify(result, null, 2));
    console.log('SUCCESS');
    process.exit(0);
} catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
}
`;

    writeFileSync(scriptPath, scriptContent, 'utf8');

    return new Promise((resolve, reject) => {
        const child = spawn('node', [scriptPath]);
        let stderr = '';
        let stdout = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            try { unlinkSync(scriptPath); } catch (e) {}

            if (code === 0) {
                resolve(outputPath);
            } else {
                reject(new Error(`Excel processing failed: ${stderr || stdout}`));
            }
        });
    });
}

/**
 * Parse CSV file properly handling quoted fields and Japanese text
 */
function parseCSV(content) {
    const lines = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const nextChar = content[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentLine += '"';
                i++; // Skip the escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
            if (currentLine.trim()) {
                lines.push(currentLine);
            }
            currentLine = '';
            if (char === '\r') i++; // Skip \n after \r
        } else if (char !== '\r') {
            currentLine += char;
        }
    }

    if (currentLine.trim()) {
        lines.push(currentLine);
    }

    if (lines.length === 0) {
        return { headers: [], data: [] };
    }

    // Parse each line into fields
    const parseRow = (line) => {
        const fields = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                fields.push(field.trim());
                field = '';
            } else {
                field += char;
            }
        }
        fields.push(field.trim());
        return fields;
    };

    const headers = parseRow(lines[0]).map((h, i) => h || `Column${i + 1}`);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseRow(lines[i]);
        // Skip empty rows
        if (values.every(v => !v)) continue;

        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = values[index] || '';
        });
        data.push(obj);
    }

    return { headers, data };
}

export default defineEventHandler(async (event) => {
    console.log('[excel-processor] Processing file upload request...');

    try {
        // Handle form data upload
        const formData = await readMultipartFormData(event);

        console.log('[excel-processor] FormData received:', formData?.length || 0, 'items');

        if (!formData || formData.length === 0) {
            console.log('[excel-processor] Error: No form data received');
            throw createError({
                statusCode: 400,
                statusMessage: 'No file provided'
            });
        }

        // Get the uploaded file
        const file = formData.find(f => f.filename) || formData[0];

        console.log('[excel-processor] File found:', file?.filename, 'Size:', file?.data?.length);

        if (!file || !file.filename) {
            console.log('[excel-processor] Error: No filename in form data');
            throw createError({
                statusCode: 400,
                statusMessage: 'No file provided'
            });
        }

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

        let headers = [];
        let data = [];
        let processedFilePath = null;

        if (fileExt === '.xlsx' || fileExt === '.xls') {
            processedFilePath = await processExcelWithChildProcess(filePath, processedDir);

            if (processedFilePath) {
                const jsonContent = await fs.readFile(processedFilePath, 'utf8');
                const parsed = JSON.parse(jsonContent);
                headers = parsed.headers || [];
                data = parsed.data || [];
            }
        } else if (fileExt === '.csv') {
            // For CSV files, detect encoding (Shift-JIS vs UTF-8) then parse
            const rawBuffer = await fs.readFile(filePath);
            const encoding = detectEncoding(rawBuffer);
            const csvContent = encoding === 'utf8'
                ? rawBuffer.toString('utf8')
                : iconv.decode(rawBuffer, encoding);
            console.log('[excel-processor] CSV encoding detected:', encoding);
            const parsed = parseCSV(csvContent);
            headers = parsed.headers;
            data = parsed.data;

            // Save processed CSV data
            processedFilePath = path.join(processedDir, `${path.basename(safeFilename, fileExt)}.json`);
            await fs.writeFile(processedFilePath, JSON.stringify({ headers, data }, null, 2));
        }

        // Clean up the original uploaded file after processing (optional)
        // await fs.unlink(filePath);

        console.log('[excel-processor] Success! Headers:', headers.length, 'Data rows:', data.length);

        return {
            success: true,
            originalName: file.filename,
            savedPath: filePath,
            processedPath: processedFilePath,
            headers: headers,
            data: data,
            rowCount: data.length
        };
    } catch (error) {
        console.error('[excel-processor] Error:', error.message || error);

        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Failed to process file'
        });
    }
});
