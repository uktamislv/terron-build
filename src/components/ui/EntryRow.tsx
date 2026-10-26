import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ShoppingCart } from 'lucide-react'
import { cx } from './cx'
import { Qty, type QtySize } from './Qty'
import { sameQty, type QtyPart } from './qtyRules'

/** Yozuv turi — chap chiziq va belgi rangi (design-system: kirim yashil, chiqim ko'k, xarid navy, o'tkazma kulrang-ko'k). */
export type EntryKind = 'kirim' | 'chiqim' | 'xarid' | 'transfer' | 'neutral' | 'danger' | 'warn' | 'ok'

const stripe: Record<EntryKind, string> = {
  kirim: 'bg-ok',
  chiqim: 'bg-brand',
  xarid: 'bg-navy',
  transfer: 'bg-transfer',
  neutral: 'bg-line',
  danger: 'bg-danger',
  warn: 'bg-warn',
  ok: 'bg-ok',
}

const iconTone: Record<EntryKind, string> = {
  kirim: 'bg-ok-bg text-ok',
  chiqim: 'bg-ice text-brand',
  xarid: 'bg-ice text-navy',
  transfer: 'bg-canvas text-transfer',
  neutral: 'bg-canvas text-muted',
  danger: 'bg-danger-bg text-danger',
  warn: 'bg-warn-bg text-warn',
  ok: 'bg-ok-bg text-ok',
}

const ic = 'size-[18px]'
const defaultIcon: Partial<Record<EntryKind, ReactNode>> = {
  kirim: <ArrowDownLeft className={ic} strokeWidth={2} />,
  chiqim: <ArrowUpRight className={ic} strokeWidth={2} />,
  xarid: <ShoppingCart className={ic} strokeWidth={1.75} />,
  transfer: <ArrowLeftRight className={ic} strokeWidth={1.75} />,
}

/**
 * "Yuk xati" qatori: chap rangli chiziq, belgi, nom va meta (alohida qatorlar), o'ngda katta raqam.
 * `deleted` — chiziq punktir, nom o'chirilgan ko'rinishda.
 */
export function EntryRow({
  kind,
  title,
  meta,
  trailing,
  trailingMeta,
  qty,
  baseQty,
  qtySize = 'md',
  icon,
  badge,
  deleted = false,
  to,
  onClick,
  actions,
  as: Tag = 'div',
  className,
  testId,
}: {
  kind: EntryKind
  title: ReactNode
  /** Nom ostidagi qatorlar (har biri alohida). */
  meta?: ReactNode
  /** O'ngdagi asosiy raqam (`Qty`/`Money`). */
  trailing?: ReactNode
  /** Raqam ostidagi kichik matn (masalan kiritilgan birlikda). */
  trailingMeta?: ReactNode
  /** Asosiy raqam (kiritilgan birlikda) — `trailing` o'rniga. */
  qty?: QtyPart
  /** Asosiy birlikdagi miqdor: "= 1 500 kg" — `qty` bilan bir xil bo'lsa ko'rsatilmaydi. */
  baseQty?: QtyPart
  qtySize?: QtySize
  icon?: ReactNode | false
  badge?: ReactNode
  deleted?: boolean
  to?: string
  onClick?: () => void
  /** Qator ostidagi amallar (tugmalar) — butun qator bosiladigan bo'lmasa. */
  actions?: ReactNode
  as?: 'div' | 'li'
  className?: string
  testId?: string
}) {
  const mainNode = trailing ?? (qty ? <Qty value={qty.value} unit={qty.unit} size={qtySize} /> : null)
  const subNode =
    trailingMeta ??
    (baseQty && !(qty && sameQty(qty, baseQty)) ? (
      <>
        = <Qty value={baseQty.value} unit={baseQty.unit} size="sm" tone="muted" />
      </>
    ) : null)
  const shownIcon = icon === false ? null : (icon ?? defaultIcon[kind] ?? null)
  const content = (
    <>
      <span
        aria-hidden
        className={cx(
          'absolute inset-y-2 left-0 w-1 rounded-r-full',
          deleted ? 'border-l-4 border-dashed border-muted/60 bg-transparent' : stripe[kind],
        )}
      />
      {shownIcon && (
        <span aria-hidden className={cx('mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg', deleted ? 'bg-canvas text-muted' : iconTone[kind])}>
          {shownIcon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cx('min-w-0 truncate text-base font-semibold', deleted ? 'text-muted line-through' : 'text-ink')}>{title}</span>
          {badge}
        </span>
        {meta && <span className="flex flex-col gap-0.5 text-xs text-muted [&>*]:flex [&>*]:items-center [&>*]:gap-1">{meta}</span>}
      </span>
      {(mainNode || subNode) && (
        <span className={cx('flex shrink-0 flex-col items-end gap-0.5 text-right', deleted && 'opacity-60')}>
          {mainNode}
          {subNode && <span className="tabular text-xs text-muted">{subNode}</span>}
        </span>
      )}
    </>
  )
  const rowCls = 'relative flex w-full items-start gap-3 py-3 pr-3 pl-4 text-left'
  const interactive = 'transition-colors hover:bg-ice/40'
  return (
    <Tag data-testid={testId} data-kind={kind} className={cx('overflow-hidden rounded-xl border border-line bg-paper', className)}>
      {to ? (
        <Link to={to} className={cx(rowCls, interactive)}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cx(rowCls, interactive)}>
          {content}
        </button>
      ) : (
        <div className={rowCls}>{content}</div>
      )}
      {actions && <div className="flex flex-wrap justify-end gap-1 border-t border-line/70 px-2 py-1">{actions}</div>}
    </Tag>
  )
}
