import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Sahifalar lazy yuklanadi; band mashinada birinchi render 1 s dan oshishi mumkin.
configure({ asyncUtilTimeout: 5000 })

// sessionStorage (masalan kirim/chiqim turi — faqat sessiya ichida eslab qolinadi) testlar orasida
// oqib o'tmasin
beforeEach(() => {
  try {
    window.sessionStorage.clear()
  } catch {
    // node muhiti (SQL testlar) — window yo'q
  }
})
