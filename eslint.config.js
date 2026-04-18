import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Image: 'readonly',
        FileReader: 'readonly',
        HTMLElement: 'readonly',
        setTimeout: 'readonly',
        console: 'readonly',
        CustomEvent: 'readonly',
        DOMParser: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        sessionStorage: 'readonly',
        btoa: 'readonly',
        AbortController: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
