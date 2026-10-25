// Batch 12 (C): rasm xeshi — WebCrypto SHA-256 (hex, kichik harf). Server faqat formatni tekshiradi.

/** Blob'ning SHA-256 xeshi. WebCrypto yo'q (eski WebView, http) — null; saqlash to'xtamaydi. */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const buffer = await blobBytes(blob)
    const digest = await subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  // jsdom va eski brauzerlar: FileReader
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('read'))
    reader.readAsArrayBuffer(blob)
  })
}
