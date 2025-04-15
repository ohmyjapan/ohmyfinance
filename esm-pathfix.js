// esm-pathfix.js
import * as url from 'url';
import * as path from 'path';

// Convert Windows paths to proper file:// URLs
export function toFileUrl(windowsPath) {
    // Normalize the path for Windows
    const normalizedPath = windowsPath.replace(/\\/g, '/');

    // Check if it's already a URL
    if (normalizedPath.startsWith('file://')) {
        return normalizedPath;
    }

    // For Windows, make sure we have the right format
    const pathWithCorrectPrefix = normalizedPath.startsWith('/')
        ? normalizedPath
        : `/${normalizedPath}`;

    return `file://${pathWithCorrectPrefix}`;
}

// Helper to get the dirname from import.meta.url
export function getDirname(importMetaUrl) {
    return path.dirname(url.fileURLToPath(importMetaUrl));
}