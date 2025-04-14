/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./components/**/*.{js,vue,ts}",
        "./layouts/**/*.vue",
        "./pages/**/*.vue",
        "./plugins/**/*.{js,ts}",
        "./app.vue",
        "./error.vue",
    ],
    theme: {
        extend: {
            colors: {
                purple: {
                    50: '#f5f3ff',
                    100: '#ede9fe',
                    200: '#ddd6fe',
                    300: '#c4b5fd',
                    400: '#a78bfa',
                    500: '#8b5cf6',
                    600: '#7c3aed',
                    700: '#6d28d9',
                    800: '#5b21b6',
                    900: '#4c1d95',
                },
                amber: {
                    50: '#fffbeb',
                    100: '#fef3c7',
                    200: '#fde68a',
                    300: '#fcd34d',
                    400: '#fbbf24',
                    500: '#f59e0b',
                    600: '#d97706',
                    700: '#b45309',
                    800: '#92400e',
                    900: '#78350f',
                }
            },
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
    ],
    safelist: [
        // Background colors for stat cards and status badges
        'bg-purple-100',
        'bg-blue-100',
        'bg-green-100',
        'bg-amber-100',
        'bg-red-100',
        'bg-yellow-100',
        'bg-gray-100',

        // Text colors
        'text-purple-600',
        'text-blue-600',
        'text-green-600',
        'text-amber-600',
        'text-red-600',
        'text-yellow-600',
        'text-gray-600',

        // Status badge text colors
        'text-green-800',
        'text-blue-800',
        'text-red-800',
        'text-yellow-800',
        'text-gray-800',

        // Trend colors
        'text-green-500',
        'text-red-500',
    ]
}