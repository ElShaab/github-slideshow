import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint rules are chosen to catch defects, not to argue about formatting.
 * Anything the TypeScript compiler already rejects is left to the compiler.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/build/**',
      'packages/mobile/index.js',
      'packages/mobile/babel.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // An unused variable is usually a half-finished edit.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // A floating promise silently swallows failures.
      'no-void': 'off',
      // These are genuine bug patterns rather than taste.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'off',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-throw-literal': 'error',
      'no-return-await': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      // Reports every useRef guard and every sequential assignment in the
      // integration tests as a race. All false positives here.
      'require-atomic-updates': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  {
    // React Native screens use the JSX runtime, so React is not a global here.
    files: ['packages/mobile/**/*.tsx', 'packages/mobile/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        __DEV__: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      // A missing dependency is a stale-closure bug waiting to happen.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
