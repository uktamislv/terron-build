// Lazy chunk yuklanmasa (yangi deploy'dan keyin eski fayl nomlari yo'q) — aniqlash va bir martalik reload.

const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const e = error as { name?: string; message?: string }
  if (e.name === 'ChunkLoadError') return true
  return CHUNK_ERROR_RE.test(String(e.message ?? error))
}

export const RELOAD_FLAG = 'terron:chunk-reload'

/**
 * Bir martalik avtomatik reload: bayroq yo'q bo'lsa — qo'yiladi va `true` (reload qilinadi);
 * bayroq bor bo'lsa (allaqachon urinilgan) — `false`, foydalanuvchiga xabar ko'rsatiladi.
 * `sessionStorage` ishlamasa — reload qilinmaydi (cheksiz aylanish bo'lmasin).
 */
export function claimAutoReload(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession()): boolean {
  if (!storage) return false
  try {
    if (storage.getItem(RELOAD_FLAG)) return false
    storage.setItem(RELOAD_FLAG, String(Date.now()))
    return true
  } catch {
    return false
  }
}

/** Ilova muvaffaqiyatli yuklangach bayroqni tozalash (keyingi deploy uchun yana bir urinish). */
export function clearAutoReloadFlag(storage: Pick<Storage, 'removeItem'> | null = safeSession()): void {
  try {
    storage?.removeItem(RELOAD_FLAG)
  } catch {
    // e'tiborsiz
  }
}

function safeSession(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

/** Vite `vite:preloadError` — chunk oldindan yuklanmasa, bir marta sahifani qayta yuklaydi. */
export function installPreloadErrorReload(win: Window = window, reload: () => void = () => win.location.reload()): () => void {
  const onError = (event: Event) => {
    if (claimAutoReload()) {
      event.preventDefault()
      reload()
    }
  }
  win.addEventListener('vite:preloadError', onError)
  return () => win.removeEventListener('vite:preloadError', onError)
}
