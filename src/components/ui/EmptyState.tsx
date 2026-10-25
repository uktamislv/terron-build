import type { ReactNode } from 'react'
import { CircleAlert, Inbox } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from './Button'
import { cx } from './cx'

/**
 * Bo'sh holat: belgi (40 px, `ice` doira), bir qator sarlavha, bir qator yo'riqnoma, ixtiyoriy tugma.
 * `tone="danger"` — xato holati ("Qayta urinish" bilan).
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  tone = 'default',
  compact = false,
  titleAs: Title = 'p',
  className,
}: {
  icon?: ReactNode
  title: string
  text?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'danger'
  compact?: boolean
  /** Butun sahifa holati (403/404) — h1. */
  titleAs?: 'p' | 'h1' | 'h2'
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper text-center',
        compact ? 'px-4 py-6' : 'px-6 py-10',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mb-1 inline-flex size-16 items-center justify-center rounded-full [&>svg]:size-8',
          tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-ice text-brand',
        )}
      >
        {icon ?? (tone === 'danger' ? <CircleAlert strokeWidth={1.5} /> : <Inbox strokeWidth={1.5} />)}
      </span>
      <Title className="text-base font-semibold text-ink">{title}</Title>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Xato: aniq sabab va "Qayta urinish". */
export function ErrorState({ message, onRetry, title }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <EmptyState
      tone="danger"
      title={title ?? message}
      text={title ? message : undefined}
      action={
        onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {t.common.retry}
          </Button>
        )
      }
    />
  )
}
