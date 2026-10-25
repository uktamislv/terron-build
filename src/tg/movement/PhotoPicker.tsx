import { useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { t } from '@/i18n'

const tm = t.tg.movement

function objectUrl(file: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
  } catch {
    return null
  }
}

export interface PickedPhoto {
  /** Siqilgan va tekshirilgan rasm (yuklashga tayyor). */
  blob: Blob
  name: string
}

/**
 * Ixtiyoriy rasm: "Suratga olish" (kamera) yoki "Galereyadan". Faqat tanlaydi —
 * siqish/tekshirish sahifada, yuklash faqat "Saqlash" bosilganda.
 */
export function PhotoPicker({
  photo,
  busy,
  onPick,
  onRemove,
}: {
  photo: PickedPhoto | null
  busy: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (photo ? objectUrl(photo.blob) : null), [photo])

  // Eski ko'rinish havolasini bo'shatish
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    // Bir xil faylni qayta tanlash mumkin bo'lsin
    e.target.value = ''
    if (picked) onPick(picked)
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={tm.takePhoto}
        className="sr-only"
        onChange={onInput}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        aria-label={tm.fromGallery}
        className="sr-only"
        onChange={onInput}
      />
      {photo ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2">
          {preview ? (
            <img src={preview} alt={tm.photoSelected} className="size-14 rounded-lg object-cover" />
          ) : (
            <span className="text-sm text-slate-700">{tm.photoSelected}</span>
          )}
          <span className="flex-1 truncate text-sm text-slate-600">{photo.name}</span>
          <button type="button" onClick={onRemove} className="min-h-11 rounded-lg px-3 text-sm font-medium text-danger">
            {tm.removePhoto}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
            className="min-h-12 rounded-xl border border-dashed border-slate-300 text-base text-slate-700 active:bg-slate-50 disabled:opacity-60"
          >
            {tm.takePhoto}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
            className="min-h-12 rounded-xl border border-dashed border-slate-300 text-base text-slate-700 active:bg-slate-50 disabled:opacity-60"
          >
            {tm.fromGallery}
          </button>
        </div>
      )}
    </div>
  )
}
