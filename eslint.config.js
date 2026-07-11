import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude holds agent worktrees (full repo checkouts) — linting it turns a
  // ~2min `eslint .` into 20+ minutes of re-linting stale copies.
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Type-only imports must be `import type` so the compiler provably erases
      // them. The engine/tax module graph has type-only back-edges that look
      // circular to bundler/madge analysis when written as value imports (23
      // phantom cycles); this keeps the runtime graph acyclic by construction
      // instead of by accident.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
    },
  },
])
