// Klaviatura ochiqligini ko'rinadigan oyna (visualViewport) balandligidan aniqlash — sof funksiya.

export interface ViewportTrack {
  /** Shu kenglikda ko'rilgan eng katta balandlik (klaviaturasiz). */
  maxHeight: number
  width: number
}

/**
 * Yangi o'lcham: kenglik o'zgarsa (ekran burildi) eng katta balandlik qaytadan o'lchanadi — aks holda
 * gorizontaldan vertikalga qaytgandan keyin eski (kichik) qiymat qolib, klaviatura noto'g'ri aniqlanardi.
 * Klaviatura odatda ekranning 1/4 qismidan ko'pini egallaydi: balandlik < 80 % — ochiq.
 */
export function trackViewport(prev: ViewportTrack, vv: { height: number; width: number }): ViewportTrack & { keyboard: boolean } {
  const maxHeight = vv.width !== prev.width ? vv.height : Math.max(prev.maxHeight, vv.height)
  return { maxHeight, width: vv.width, keyboard: vv.height < maxHeight * 0.8 }
}
