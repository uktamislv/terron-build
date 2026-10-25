import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui'

// Smeta sahifasi (import ustasi, SheetJS) alohida chunk'da — bosh bundle kattalashmasin
const EstimatesPage = lazy(() => import('./EstimatesPage').then((m) => ({ default: m.EstimatesPage })))

export function EstimatesRoute() {
  return (
    <Suspense fallback={<Spinner />}>
      <EstimatesPage />
    </Suspense>
  )
}
