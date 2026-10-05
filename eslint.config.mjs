import { defineConfig, globalIgnores } from 'eslint/config';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  globalIgnores(['.next/**','out/**','dist/**','build/**','.sites-runtime/**','.netlify/**','.wrangler/**','next-env.d.ts']),
  { files: ['**/*.ts','**/*.tsx'], languageOptions: { parser: tsParser }, plugins: { '@typescript-eslint': tsPlugin }, rules: tsPlugin.configs.recommended.rules },
  { files: ['app/**/*.tsx'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'warn' } },
]);
