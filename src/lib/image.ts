// Rasmni yuklashdan oldin siqish: eng uzun tomon `maxSide` px, JPEG `quality`.
// Brauzer API'lari (createImageBitmap, canvas) `deps` orqali beriladi — testda soxtasi ishlatiladi.

export interface CompressOptions {
  maxSide?: number
  quality?: number
}

export interface DecodedImage {
  width: number
  height: number
  /** canvas'ga chizish uchun manba */
  source: CanvasImageSource
  close?: () => void
}

export interface ImageDeps {
  decode(file: Blob): Promise<DecodedImage>
  createCanvas(width: number, height: number): {
    getContext(type: '2d'): Pick<CanvasRenderingContext2D, 'drawImage'> | null
    toBlob(cb: (blob: Blob | null) => void, type: string, quality: number): void
  }
}

const browserDeps: ImageDeps = {
  async decode(file) {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
  },
  createCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  },
}

/** Yangi o'lcham: proporsiya saqlanadi, kichik rasm kattalashtirilmaydi. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxSide || longest === 0) return { width, height }
  const k = maxSide / longest
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** Siqilgan JPEG yoki `null` (dekodlab/chizib bo'lmadi). */
async function tryCompress(file: Blob, maxSide: number, quality: number, deps: ImageDeps): Promise<Blob | null> {
  let img: DecodedImage
  try {
    img = await deps.decode(file)
  } catch {
    return null
  }
  try {
    const size = fitSize(img.width, img.height, maxSide)
    const canvas = deps.createCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img.source, 0, 0, size.width, size.height)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  } catch {
    return null
  } finally {
    img.close?.()
  }
}

/**
 * Rasmni JPEG'ga siqadi. Dekodlab bo'lmasa yoki canvas ishlamasa — asl fayl qaytadi.
 */
export async function compressImage(
  file: Blob,
  { maxSide = 1600, quality = 0.8 }: CompressOptions = {},
  deps: ImageDeps = browserDeps,
): Promise<Blob> {
  return (await tryCompress(file, maxSide, quality, deps)) ?? file
}

/** Storage `photos` bucket'i qabul qiladigan turlar va hajm (docs/ops-design.md). */
export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

export type PhotoProblem = 'photo_type' | 'photo_too_large'

/**
 * Yuklashga tayyorlash (tanlash paytida, yuklamasdan): siqadi va tur/hajmni tekshiradi.
 * Siqib bo'lmasa (masalan HEIC ochilmasa) — asl fayl faqat ruxsat etilgan tur bo'lsa ishlatiladi.
 */
export async function preparePhoto(
  file: Blob,
  options: CompressOptions = {},
  deps: ImageDeps = browserDeps,
): Promise<{ ok: true; blob: Blob } | { ok: false; reason: PhotoProblem }> {
  const compressed = await tryCompress(file, options.maxSide ?? 1600, options.quality ?? 0.8, deps)
  const blob = compressed ?? file
  if (!PHOTO_TYPES.includes(blob.type)) return { ok: false, reason: 'photo_type' }
  if (blob.size > PHOTO_MAX_BYTES) return { ok: false, reason: 'photo_too_large' }
  return { ok: true, blob }
}
