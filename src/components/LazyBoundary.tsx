import { Suspense, type ReactNode } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { Spinner } from './ui'

/** Lazy sahifa: yuklanguncha — spinner; chunk yuklanmasa yoki sahifa yiqilsa — "Qayta yuklash". */
export function LazyBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </ErrorBoundary>
  )
}
