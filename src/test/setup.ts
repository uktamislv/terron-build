import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Sahifalar lazy yuklanadi; band mashinada birinchi render 1 s dan oshishi mumkin.
configure({ asyncUtilTimeout: 5000 })
