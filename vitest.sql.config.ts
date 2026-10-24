import { defineConfig } from 'vitest/config'

// `npm run test:sql` — supabase/migrations/*.sql ni PGlite (WASM Postgres) da
// qo'llab, SQL darajasidagi testlarni ishga tushiradi. Oddiy `npm run test`
// (vite.config.ts, include: src/**) bu fayllarni ishga tushirmaydi.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['supabase/tests/sql/**/*.sql.test.ts'],
    // Har fayl beforeAll'da o'z bazasini quradi — sekin/band mashinada ham sig'sin.
    hookTimeout: 300_000,
    testTimeout: 120_000,
    // Bitta jarayon: WASM xotirasi parallelda shishmasin, band CPU'da worker timeout bo'lmasin.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
  },
})
