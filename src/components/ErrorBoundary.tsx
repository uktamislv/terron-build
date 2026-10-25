// Xato chegaralari: lazy chunk yuklanmasa — "Ilova yangilandi", boshqa xato — umumiy matn.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { t } from '@/i18n'
import { isChunkLoadError } from '@/lib/chunkErrors'
import { Button } from './ui'

function reloadPage() {
  window.location.reload()
}

/** Butun sahifa o'rnidagi xato ekrani (route `errorElement` va lazy chegara). */
export function AppErrorScreen({ error }: { error: unknown }) {
  const chunk = isChunkLoadError(error)
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-brand-dark">{chunk ? t.appError.chunkTitle : t.appError.title}</h1>
      <p className="max-w-md text-sm text-slate-600">{chunk ? t.appError.chunkText : t.appError.text}</p>
      <Button onClick={reloadPage}>{t.appError.reload}</Button>
    </div>
  )
}

/** Router `errorElement`: render/loader xatosi. */
export function RouteErrorPage() {
  const error = useRouteError()
  return <AppErrorScreen error={error} />
}

interface Props {
  children: ReactNode
  /** Berilmasa — `AppErrorScreen`. */
  fallback?: (error: unknown) => ReactNode
}

export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('unknown') }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack)
  }

  render() {
    if (this.state.error) return this.props.fallback ? this.props.fallback(this.state.error) : <AppErrorScreen error={this.state.error} />
    return this.props.children
  }
}
