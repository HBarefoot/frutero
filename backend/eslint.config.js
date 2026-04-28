// Flat ESLint config for the Pi backend. Same rule set as the cloud
// (frutero-fleet) minus the multi-tenant lint rule — Pi is single-tenant
// so there's no `*ForOrg` discipline to enforce.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'public/**',
      'data/**',
      'dev.db*',
      'mushroom.db*',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-console': 'off',
    },
  },
  {
    // Tests run in node:test — looser unused-vars.
    files: ['test/**/*.js', '**/*.test.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
