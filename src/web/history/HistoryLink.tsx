// Boshqa sahifalardagi yozuv tafsilotida "Tarix" havolasi (faqat admin / direktor — `view_audit`).
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { cx } from '@/components/ui'
import { t } from '@/i18n'
import { useHistoryHref } from './useHistoryHref'

export function HistoryLink({ table, id, className }: { table: string | null; id: string; className?: string }) {
  const href = useHistoryHref()(table, id)
  if (!href) return null
  return (
    <Link
      to={href}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 text-sm font-semibold text-ink hover:bg-canvas',
        className,
      )}
    >
      <History aria-hidden className="size-5" strokeWidth={1.75} />
      {t.history.link}
    </Link>
  )
}
