import { defineNuxtPlugin } from '#app';
import { toFileUrl, resolveFromModule } from '../utils/path';

/**
 * Plugin to provide path utilities throughout the application
 */
export default defineNuxtPlugin((nuxtApp) => {
    // Ensure correct file paths on all platforms (especially Windows)
    const utils = {
        /**
         * Converts a file path to a proper file:// URL
         */
        toFileUrl: (path: string): string => toFileUrl(path),

        /**
         * Resolves a path relative to the application root
         */
        resolveFromRoot: (...paths: string[]): string => {
            return resolveFromModule(import.meta.url, '..', ...paths);
        }
    };

    return {
        provide: {
            path: utils
        }
    };
});