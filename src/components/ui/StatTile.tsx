import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { cx } from './cx'

export type StatTone = 'default' | 'danger' | 'warn' | 'ok'

const iconTone: Record<StatTone, string> = {
  default: 'bg-ice text-brand',
  danger: 'bg-danger-bg text-danger',
  warn: 'bg-warn-bg text-warn',
  ok: 'bg-ok-bg text-ok',
}

/**
 * Raqamli kartochka: belgi, nom, katta raqam, izoh. `to` berilsa — butun kartochka havola.
 * `live` — "hozir" belgisi (davrga bog'liq emas, joriy holat).
 */
export function StatTile({
  icon,
  label,
  value,
  hint,
  to,
  tone = 'default',
  live = false,
  testId,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  hint?: ReactNode
  to?: string
  tone?: StatTone
  live?: boolean
  testId?: string
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cx('inline-flex size-9 items-center justify-center rounded-lg [&>svg]:size-5', iconTone[tone])}>{icon}</span>
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ice px-2 py-0.5 text-xs font-semibold text-brand">
            <span aria-hidden className="size-1.5 rounded-full bg-brand" />
            {t.ui.now}
          </span>
        )}
        {to && !live && <ChevronRight aria-hidden className="size-5 text-muted transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />}
      </div>
      <span className="mt-3 text-sm text-muted">{label}</span>
      <span className={cx('tabular mt-1 text-2xl leading-tight font-semibold break-words', tone === 'danger' ? 'text-danger' : 'text-ink')}>
        {value}
      </span>
      {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
    </>
  )
  const cls = 'group flex min-h-full flex-col rounded-xl border border-line bg-paper p-4'
  return to ? (
    <Link to={to} data-testid={testId} className={cx(cls, 'transition-colors hover:border-brand/40 hover:bg-ice/30')}>
      {body}
    </Link>
  ) : (
    <div data-testid={testId} className={cls}>
      {body}
    </div>
  )
}
