import { useCallback, useMemo, useState } from 'react'
import { isPhotoError, uploadPhoto, type PhotoKind } from '@/data/photosRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { preparePhoto } from '@/lib/image'
import { sha256Hex } from '@/lib/sha256'
import type { PickedPhoto } from './PhotoPicker'

/**
 * Ixtiyoriy rasm oqimi (kirim/chiqim va xarid uchun umumiy):
 * tanlash → siqish/tekshirish → faqat "Saqlash" da yuklash. Yuklangan yo'l eslab qolinadi —
 * saqlash xato bo'lsa, qayta urinishda rasm qayta yuklanmaydi. Rasm xatosi saqlashni to'xtatmaydi:
 * "Qayta urinish" yoki "Rasmsiz saqlash".
 */
export function usePhotoDraft({ kind = 'ops' }: { kind?: PhotoKind } = {}) {
  const [photo, setPhoto] = useState<PickedPhoto | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<{ blob: Blob; path: string } | null>(null)

  const pick = useCallback(async (file: File) => {
    setNotice(null)
    setError(null)
    setPreparing(true)
    try {
      // Xesh asl fayldan (Batch 12, C): bir xil rasm qayta tanlansa — bir xil xesh
      const [result, sha256] = await Promise.all([preparePhoto(file, { maxSide: 1600, quality: 0.8 }), sha256Hex(file)])
      if (result.ok) {
        setPhoto({ blob: result.blob, name: file.name, sha256 })
      } else {
        // Ochib bo'lmaydigan yoki katta rasm — olib tashlanadi, forma saqlanadi
        setPhoto(null)
        setNotice(t.errors[result.reason])
      }
      setUploaded(null)
    } finally {
      setPreparing(false)
    }
  }, [])

  const remove = useCallback(() => {
    setPhoto(null)
    setUploaded(null)
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setPhoto(null)
    setUploaded(null)
    setNotice(null)
    setError(null)
  }, [])

  /** Saqlashdan oldin: rasm yo'li (kerak bo'lsa yuklaydi). `withoutPhoto` — rasm tashlanadi. */
  const resolvePath = useCallback(
    async (companyId: string, withoutPhoto = false): Promise<string | null> => {
      setError(null)
      if (withoutPhoto) {
        setPhoto(null)
        setUploaded(null)
        return null
      }
      if (!photo) return null
      if (uploaded && uploaded.blob === photo.blob) return uploaded.path
      const path = await uploadPhoto(photo.blob, companyId, kind)
      setUploaded({ blob: photo.blob, path })
      return path
    },
    [photo, uploaded, kind],
  )

  /** Saqlash xatosi rasm bilan bog'liq bo'lsa — rasm bo'limida ko'rsatiladi (true qaytaradi). */
  const handleSaveError = useCallback((err: unknown): boolean => {
    if (!isPhotoError(err)) return false
    setUploaded(null)
    setError(errorText(err))
    return true
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return useMemo(
    () => ({ photo, preparing, notice, error, pick, remove, reset, resolvePath, handleSaveError, clearError }),
    [photo, preparing, notice, error, pick, remove, reset, resolvePath, handleSaveError, clearError],
  )
}
