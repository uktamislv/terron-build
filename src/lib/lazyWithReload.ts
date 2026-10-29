// Audit 3 (E5): lazy chunk import'i xato bersa (yangi deploy'dan keyin eski fayl nomi yo'q) —
// sahifa bir marta avtomatik qayta yuklanadi. Ikkinchi marta — xato chegarasiga (ErrorBoundary,
// "Ilova yangilandi" ekrani) uzatiladi, cheksiz aylanish bo'lmaydi.
import { claimAutoReload, isChunkLoadError } from './chunkErrors'

/**
 * `import()` funksiyasini o'raydi: chunk xatosida `claimAutoReload()` ruxsat bersa — `reload()` va
 * hech qachon tugamaydigan va'da (sahifa yangilanguncha Suspense kutadi); aks holda xato qayta tashlanadi.
 */
export function importWithReload<T>(
  load: () => Promise<T>,
  reload: () => void = () => window.location.reload(),
  claim: () => boolean = () => claimAutoReload(),
): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      if (isChunkLoadError(error) && claim()) {
        reload()
        return new Promise<T>(() => undefined)
      }
      throw error
    })
}
