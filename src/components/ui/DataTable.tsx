import type { ReactNode } from 'react'
import { cx } from './cx'
import { useIsMobile } from './useMediaQuery'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T, index: number) => ReactNode
  /** Raqamlar — 'right' (tabular). */
  align?: 'left' | 'right' | 'center'
  className?: string
  /** Sarlavha ekran o'quvchi uchun (masalan, amallar ustuni). */
  srHeader?: boolean
}

/**
 * Jadval: kompyuterda qotgan sarlavha, ixcham qatorlar, o'ngga tekislangan raqamlar, hover.
 * Telefonda (< 768 px) `renderMobile` berilsa — qatorlar ro'yxati (`EntryRow`).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  renderMobile,
  caption,
  empty,
  rowClassName,
  footer,
  className,
  testId,
  rowTestId,
  rowData,
}: {
  columns: readonly (Column<T> | false | null | undefined)[]
  rows: readonly T[]
  rowKey: (row: T) => string
  renderMobile?: (row: T, index: number) => ReactNode
  /** Ekran o'quvchi uchun jadval nomi. */
  caption?: string
  /** Qator bo'lmasa — shu (odatda `EmptyState`). */
  empty?: ReactNode
  rowClassName?: (row: T) => string | undefined
  /** Jadval ostidagi qism (sahifalash). */
  footer?: ReactNode
  className?: string
  testId?: string
  /** Har bir qator (tr / telefonda li) uchun data-testid. */
  rowTestId?: string
  /** Qatorga qo'shimcha `data-*` atributlar (holat va h.k.). */
  rowData?: (row: T) => Record<`data-${string}`, string | undefined>
}) {
  const mobile = useIsMobile()
  const cols = columns.filter((c): c is Column<T> => Boolean(c))

  if (rows.length === 0 && empty) return <>{empty}</>

  if (mobile && renderMobile) {
    return (
      <div className={cx('flex flex-col gap-3', className)} data-testid={testId}>
        <ul aria-label={caption} className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={rowKey(row)} data-testid={rowTestId} {...rowData?.(row)}>
              {renderMobile(row, i)}
            </li>
          ))}
        </ul>
        {footer}
      </div>
    )
  }

  return (
    <div className={cx('flex flex-col gap-3', className)} data-testid={testId}>
      <div className="overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cx(
                    'sticky top-0 z-[1] border-b border-line bg-canvas px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-muted first:pl-4 last:pr-4',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  )}
                >
                  {c.srHeader ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row)} data-testid={rowTestId} {...rowData?.(row)} className={cx('border-b border-line/70 transition-colors last:border-0 hover:bg-ice/35', rowClassName?.(row))}>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      'px-3 py-2.5 align-middle first:pl-4 last:pr-4',
                      c.align === 'right' && 'tabular text-right whitespace-nowrap',
                      c.align === 'center' && 'text-center',
                      c.className,
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  )
}
