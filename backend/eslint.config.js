/**
 * Global_Fit_Ulttra - ESLint Configuration (Flat Config - ESLint 9+)
 * 
 * Uses the new flat config format with proper languageOptions and globals.
 */

import globals from 'globals';
import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2021,
                ...globals.jest,
            },
        },
        rules: {
            'no-console': 'warn',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'prefer-const': 'error',
            'no-var': 'error',
            'eqeqeq': 'error',
            semi: ['error', 'always'],
            quotes: ['error', 'single', { avoidEscape: true }],
        },
    },
    {
        ignores: ['node_modules/', 'dist/', 'coverage/', 'logs/'],
    },
];
