/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Edge Function'lar bilan umumiy sof TS (telefon, login email, Telegram initData)
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // _shared testlari faylning boshida `// @vitest-environment node` bilan ishlaydi
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts', 'supabase/functions/*/logic.test.ts'],
  },
})
