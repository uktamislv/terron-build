import { useEffect, useState } from 'react'
import { signedPhotoUrl } from '@/data/photosRepo'
import { t } from '@/i18n'
import { ImageOff } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'

/** Private bucket'dagi rasm — vaqtinchalik (signed) havola orqali. */
export function MovementPhoto({ path, alt }: { path: string; alt: string }) {
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    signedPhotoUrl(path)
      .then((url) => {
        if (alive) setState({ path, url, failed: false })
      })
      .catch(() => {
        if (alive) setState({ path, url: null, failed: true })
      })
    return () => {
      alive = false
    }
  }, [path])

  if (!state || state.path !== path)
    return (
      <div role="status">
        <span className="sr-only">{t.common.loading}</span>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  if (state.failed || !state.url) return <EmptyState compact tone="danger" icon={<ImageOff strokeWidth={1.5} />} title={t.movements.photoError} />
  // Faqat ilova ichida ko'rsatiladi (tashqi havola yo'q — signed URL tarqalmasin)
  return <img src={state.url} alt={alt} className="max-h-96 w-full rounded-xl border border-line bg-canvas object-contain" />
}
