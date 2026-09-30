import js from '@eslint/js';
import globals from 'globals';

/**
 * Backend lint rules.
 * ---------------------------------------------------------------------------
 * `no-undef` is the rule that matters most here: this codebase does bulk
 * find-and-replace across service files, and an undeclared identifier left
 * behind by a rename is a runtime crash on a code path that may only execute
 * during checkout. Lint catches it before a customer does.
 */
export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off', // The logger intentionally writes to stdout.
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
    },
  },
  { ignores: ['node_modules/**', 'uploads/**'] },
];
