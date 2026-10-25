import { ChevronLeft, ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from './Button'

/** Sahifalash: "1–50 / 120" va Oldingi/Keyingi. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const first = total === 0 ? 0 : page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="tabular text-sm text-muted">{t.ombor.pageInfo(first, last, total)}</span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          icon={<ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />}
        >
          {t.ombor.prev}
        </Button>
        <Button variant="secondary" disabled={last >= total} onClick={() => onPage(page + 1)}>
          {t.ombor.next}
          <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}
