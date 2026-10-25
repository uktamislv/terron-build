import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { clearAutoReloadFlag, installPreloadErrorReload } from './lib/chunkErrors'
import './index.css'

// Yangi deploy'dan keyin eski chunk topilmasa — bir martalik avtomatik qayta yuklash
installPreloadErrorReload()
// Ilova bir daqiqa barqaror ishlasa — keyingi deploy uchun yana bir urinishga ruxsat
setTimeout(() => clearAutoReloadFlag(), 60_000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
