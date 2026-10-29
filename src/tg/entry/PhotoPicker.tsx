import { useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { Camera, Image as ImageIcon, LoaderCircle, Trash2 } from 'lucide-react'
import { Badge, Button, Notice } from '@/components/ui'
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
        <div className="flex items-center gap-3 rounded-xl border border-line bg-paper p-2">
          {preview ? (
            <img src={preview} alt={tm.photoSelected} className="size-14 rounded-lg object-cover" />
          ) : (
            <span className="text-sm text-muted">{tm.photoSelected}</span>
          )}
          <span className="flex-1 truncate text-sm text-muted">{photo.name}</span>
          <button type="button" onClick={onRemove} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-danger hover:bg-danger-bg">
            <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
            {tm.removePhoto}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
            className="inline-flex min-h-13 items-center justify-center gap-2 rounded-xl border border-dashed border-muted/40 bg-paper text-base font-medium text-ink active:bg-ice disabled:opacity-60"
          >
            <Camera aria-hidden className="size-5 text-muted" strokeWidth={1.75} />
            {tm.takePhoto}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
            className="inline-flex min-h-13 items-center justify-center gap-2 rounded-xl border border-dashed border-muted/40 bg-paper text-base font-medium text-ink active:bg-ice disabled:opacity-60"
          >
            <ImageIcon aria-hidden className="size-5 text-muted" strokeWidth={1.75} />
            {tm.fromGallery}
          </button>
        </div>
      )}
    </div>
  )
}

/** Rasm bo'limi: sarlavha, tanlash, tayyorlash belgisi va ogohlantirish. */
export function PhotoField({
  label,
  photo,
  busy,
  preparing,
  notice,
  requiredReason = null,
  onPick,
  onRemove,
}: {
  label: string
  /** Batch 12 (E): rasm majburiy bo'lsa — sabab matni (belgi va izoh ko'rsatiladi). */
  requiredReason?: string | null
  photo: PickedPhoto | null
  busy: boolean
  preparing: boolean
  notice: string | null
  onPick: (file: File) => void
  onRemove: () => void
}) {
  return (
    <div data-photo-field="" data-missing={requiredReason && !photo ? 'true' : undefined} className="flex scroll-mt-20 flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <Camera aria-hidden className="size-4 text-muted" strokeWidth={1.75} />
        {label}
        {requiredReason ? (
          <Badge tone="warn" className="font-semibold">
            <span data-testid="photo-required">{t.tg.auto.photoRequired}</span>
          </Badge>
        ) : (
          <span className="font-normal text-muted">{t.ui.optional}</span>
        )}
      </span>
      {requiredReason && !photo && <p className="text-sm text-danger">{requiredReason}</p>}
      <PhotoPicker photo={photo} busy={busy} onPick={onPick} onRemove={onRemove} />
      {preparing && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin" strokeWidth={2} />
          {tm.preparingPhoto}
        </p>
      )}
      {notice && <Notice tone="warn">{notice}</Notice>}
    </div>
  )
}

/** Rasm yuklanmadi — "Qayta urinish" yoki "Rasmsiz saqlash". */
export function PhotoErrorBox({
  message,
  busy,
  onRetry,
  onWithoutPhoto,
}: {
  message: string
  busy: boolean
  onRetry: () => void
  /** null — rasm majburiy, "Rasmsiz saqlash" yo'q. */
  onWithoutPhoto: (() => void) | null
}) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/20 bg-danger-bg p-3">
      <p className="text-sm font-medium text-danger">{message}</p>
      <div className={onWithoutPhoto ? 'grid grid-cols-2 gap-2' : 'grid gap-2'}>
        <Button variant="secondary" disabled={busy} onClick={onRetry}>
          {t.common.retry}
        </Button>
        {onWithoutPhoto && (
          <Button variant="primary" disabled={busy} onClick={onWithoutPhoto}>
            {tm.saveWithoutPhoto}
          </Button>
        )}
      </div>
    </div>
  )
}
