import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Deno'ga xos fayllar (Edge Function handler'lari va Deno yordamchilari) lint qilinmaydi;
    // supabase/functions/_shared dagi sof TS esa lint qilinadi.
    ignores: [
      'dist',
      'coverage',
      'supabase/functions/*/index.ts',
      'supabase/functions/_shared/supabaseAdmin.ts',
      'supabase/functions/_shared/http.ts',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Arxitektura qoidasi 2: Supabase faqat src/data/ ichida
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/data/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: "Supabase faqat src/data/ ichidagi repository fayllarida ishlatiladi.",
            },
          ],
          patterns: [
            {
              group: ['**/data/supabaseClient', '@/data/supabaseClient'],
              message: "supabaseClient faqat src/data/ ichida import qilinadi — repository funksiyasidan foydalaning.",
            },
          ],
        },
      ],
    },
  },
)
