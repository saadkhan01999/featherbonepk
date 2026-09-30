import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Frontend lint rules.
 * ---------------------------------------------------------------------------
 * `eslint-plugin-react` is REQUIRED here, not optional. Without its
 * `jsx-uses-vars` rule ESLint cannot see `<Button />` as a use of the imported
 * `Button`, so every component import looks unused. The usual workaround —
 * ignoring all PascalCase variables — silences those false positives by also
 * silencing every genuinely dead import. Enabling the plugin lets the ignore
 * pattern stay narrow (`^_`, the deliberate-discard convention) so real dead
 * code still surfaces.
 */
export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  { ignores: ['node_modules/**', 'dist/**'] },
];
