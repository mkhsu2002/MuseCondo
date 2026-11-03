import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-demo/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } } },
);
