import type { ReactNode } from 'react'
import type { DiffChange, DiffItem, DiffResult } from '@/domain/estimate'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'

const td = t.estimates.diff

function qtyText(qty: string, unit: string): string {
  return `${formatQty(qty)} ${unit}`.trim()
}

function priceText(p: string | null): string {
  return p === null ? '—' : formatSum(p)
}

function ItemLine({ item }: { item: DiffItem }) {
  return (
    <li className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
      <span className="font-medium text-ink">{item.name}</span>
      <span className="text-muted">
        {qtyText(item.qty, item.unit)} · {priceText(item.price)}
      </span>
    </li>
  )
}

function ChangeLine({ c }: { c: DiffChange }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <span className="font-medium text-ink">{c.name}</span>
      <span className="text-muted">
        {td.qty}: {qtyText(c.qtyBefore, c.unitBefore)} → <b>{qtyText(c.qtyAfter, c.unitAfter)}</b>
      </span>
      <span className="text-muted">
        {td.price}: {priceText(c.priceBefore)} → <b>{priceText(c.priceAfter)}</b>
      </span>
    </li>
  )
}

function Section({
  title,
  tone,
  count,
  children,
}: {
  title: string
  tone: 'ok' | 'danger' | 'warn'
  count: number
  children: ReactNode
}) {
  const border = { ok: 'border-l-ok', danger: 'border-l-danger', warn: 'border-l-warn' }[tone]
  const text = { ok: 'text-ok', danger: 'text-danger', warn: 'text-warn' }[tone]
  if (count === 0) return null
  return (
    <section
      aria-label={title}
      data-tone={tone}
      className={`rounded-xl border border-l-4 border-line ${border} bg-paper`}
    >
      <h4 className={`px-3 pt-3 font-semibold ${text}`}>
        {title}: {count}
      </h4>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  )
}

/** Ikki versiya farqi: qo'shilgan (yashil), olib tashlangan (qizil), o'zgargan (sariq). */
export function DiffView({ diff }: { diff: DiffResult }) {
  const none = diff.added.length + diff.removed.length + diff.changed.length === 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>
          {td.totalBefore}: <b className="tabular text-ink">{formatSum(diff.totalBefore)}</b>
        </span>
        <span>
          {td.totalAfter}: <b className="tabular text-ink">{formatSum(diff.totalAfter)}</b>
        </span>
        <span>{td.unchanged(diff.unchangedCount)}</span>
      </div>
      {none && <p className="text-sm text-muted">{td.none}</p>}
      <Section title={td.added} tone="ok" count={diff.added.length}>
        {diff.added.map((i) => (
          <ItemLine key={i.key} item={i} />
        ))}
      </Section>
      <Section title={td.removed} tone="danger" count={diff.removed.length}>
        {diff.removed.map((i) => (
          <ItemLine key={i.key} item={i} />
        ))}
      </Section>
      <Section title={td.changed} tone="warn" count={diff.changed.length}>
        {diff.changed.map((c) => (
          <ChangeLine key={c.key} c={c} />
        ))}
      </Section>
    </div>
  )
}
