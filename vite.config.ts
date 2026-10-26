/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Kutubxonalar alohida (uzoq keshlanadi); sahifalar — route darajasida lazy (src/routes.tsx).
        // Recharts va xlsx faqat dinamik import orqali — o'z chunk'larida qoladi.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'vendor-supabase', test: /[\\/]node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
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
    // Og'ir sahifa testlari (Mini App formalari) sekin mashinada 5 s dan oshishi mumkin
    testTimeout: 15000,
    // _shared testlari faylning boshida `// @vitest-environment node` bilan ishlaydi
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts', 'supabase/functions/*/logic.test.ts'],
  },
})
