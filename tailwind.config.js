const defaultTheme = require('tailwindcss/defaultTheme')

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
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        'primary': {
          light: '#F3D9D7',
          main: '#C0392B',
          dark: '#962D22',
        },
        'secondary': {
          light: '#E9ECEF',
          main: '#8A9099',
          dark: '#4D5762',
        },
        'success': {
          light: '#D4F4E2',
          main: '#28C76F',
          dark: '#1F9D57',
        },
        'info': {
          light: '#CCF3FF',
          main: '#00CFE8',
          dark: '#0097AF',
        },
        'warning': {
          light: '#FFF5DF',
          main: '#FF9F43',
          dark: '#FF7D00',
        },
        'error': {
          light: '#FFE7E6',
          main: '#EA5455',
          dark: '#D43D3E',
        },
        'background': {
          default: '#F8F7FA',
          paper: '#FFFFFF',
          dark: '#0f172a',
          darkPaper: '#1e293b'
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
    // Background colors
    'bg-primary-light', 'bg-primary-main', 'bg-primary-dark',
    'bg-primary-main/20',
    'bg-secondary-light', 'bg-secondary-main', 'bg-secondary-dark',
    'bg-success-light', 'bg-success-main', 'bg-success-dark',
    'bg-info-light', 'bg-info-main', 'bg-info-dark',
    'bg-warning-light', 'bg-warning-main', 'bg-warning-dark',
    'bg-error-light', 'bg-error-main', 'bg-error-dark',
    'bg-background-default', 'bg-background-paper', 'bg-background-dark', 'bg-background-darkPaper',
    // Text colors
    'text-primary-main', 'text-primary-dark', 'text-primary-light',
    'text-secondary-main', 'text-secondary-dark',
    'text-success-main', 'text-success-dark',
    'text-info-main', 'text-info-dark',
    'text-warning-main', 'text-warning-dark',
    'text-error-main', 'text-error-dark',
    // Alpha utilities
    'bg-white/5', 'bg-white/10', 'bg-white/80',
    'border-white/10',
    'dark:bg-white/5', 'dark:bg-white/10',
    'dark:border-white/10',
    // Legacy colors
    'bg-blue-100', 'bg-green-100', 'bg-amber-100', 'bg-red-100',
    'text-blue-600', 'text-green-600', 'text-amber-600', 'text-red-600',
  ]
}
