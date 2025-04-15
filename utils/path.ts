import { fileURLToPath } from 'url';
import { dirname, resolve, normalize } from 'path';

/**
 * Converts a file path to a valid file:// URL
 * Handles Windows-specific path issues
 */
export function toFileUrl(path: string): string {
    // Normalize the path to handle any path separators
    const normalizedPath = normalize(path);

    // Check if it's already a file URL
    if (normalizedPath.startsWith('file://')) {
        return normalizedPath;
    }

    // On Windows, paths need special handling
    if (process.platform === 'win32') {
        // Ensure path starts with a slash and convert backslashes to forward slashes
        const pathWithForwardSlashes = normalizedPath.replace(/\\/g, '/');

        // Add the file:// prefix and ensure the path starts with a slash
        return pathWithForwardSlashes.startsWith('/')
            ? `file://${pathWithForwardSlashes}`
            : `file:///${pathWithForwardSlashes}`;
    }

    // For non-Windows platforms
    return `file://${normalizedPath}`;
}

/**
 * Gets the directory name of the current module
 */
export function getDirname(importMetaUrl: string): string {
    return dirname(fileURLToPath(importMetaUrl));
}

/**
 * Resolves a path relative to the current module
 */
export function resolveFromModule(importMetaUrl: string, ...paths: string[]): string {
    return resolve(getDirname(importMetaUrl), ...paths);
}

/**
 * Creates a valid import path that works with ESM
 */
export function createImportPath(path: string): string {
    return path.startsWith('file://') ? path : toFileUrl(path);
}