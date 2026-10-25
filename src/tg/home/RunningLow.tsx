// Batch 12 (K): "Tugayotganlar" — `stock_forecast` bo'yicha `days_left ≤ forecast_days_warn`
// materiallar; "So'rov yuborish" (7 kunlik sarf, smeta qoldig'idan oshmaydi) va boshqa obyektda
// bo'lsa "O'tkazma so'rash". Tugmalar faqat so'rov yubora oladiganlarga (prorab, admin).
import { useNavigate } from 'react-router-dom'
import { ArrowLeftRight, ClipboardList, Hourglass } from 'lucide-react'
import { cx } from '@/components/ui'
import { getStockForecast, type StockForecastRow } from '@/data/forecastRepo'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { cmp, isZero, round } from '@/domain/decimal'
import { isRunningOut, SUGGEST_DAYS, suggestRequestQty } from '@/domain/forecast'
import { can, type Role } from '@/domain/roles'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { useCompanySettings } from '../entry/useCompanySettings'
import { makePrefillState } from '../request/prefill'
import { haptic } from '../telegram'
import { SectionTitle } from '../ui'

const ta = t.tg.auto

export interface RunningLowItem {
  row: StockForecastRow
  objectName: string
  materialName: string
  baseUnit: string
  /** So'rov miqdori taklifi (asosiy birlikda, 2 kasrgacha) yoki null. */
  suggestQty: string | null
}

async function loadRunningLow(companyId: string, warnDays: number): Promise<RunningLowItem[]> {
  const [objects, materials] = await Promise.all([listObjects(), listMaterials()])
  const active = objects.filter((o) => o.status === 'faol' && o.company_id === companyId)
  const byMaterial = new Map(materials.map((m) => [m.id, m]))
  const perObject = await Promise.all(active.map((o) => getStockForecast(o.id).catch(() => [] as StockForecastRow[])))
  const items: RunningLowItem[] = []
  perObject.forEach((rows, i) => {
    const object = active[i]
    if (!object) return
    for (const row of rows) {
      const material = byMaterial.get(row.materialId)
      if (!material || !isRunningOut(row.daysLeft, warnDays)) continue
      const q = suggestRequestQty(row.avgDailyOut, SUGGEST_DAYS, row.estimateRemainingQtyBase)
      const rounded = q !== null ? round(q, 2) : null
      items.push({
        row,
        objectName: object.name,
        materialName: material.name,
        baseUnit: material.base_unit,
        suggestQty: rounded !== null && !isZero(rounded) ? rounded : null,
      })
    }
  })
  return items.sort((a, b) => cmp(a.row.daysLeft ?? '0', b.row.daysLeft ?? '0') || a.materialName.localeCompare(b.materialName, 'uz'))
}

export function RunningLow({ companyId, role }: { companyId: string; role: Role }) {
  const settings = useCompanySettings(companyId)
  const data = useLoad(() => loadRunningLow(companyId, settings.forecastDaysWarn), `${companyId}:${settings.forecastDaysWarn}`)
  const navigate = useNavigate()
  const canRequest = can(role, 'create_request')
  // Ixtiyoriy blok: yuklanmasa yoki bo'sh bo'lsa — ko'rsatilmaydi
  if (!data.data || data.data.length === 0) return null
  const manyObjects = new Set(data.data.map((i) => i.row.objectId)).size > 1

  const openRequest = (item: RunningLowItem, transfer: boolean) => {
    haptic.tap()
    navigate('/tg/request', {
      state: makePrefillState({
        objectId: item.row.objectId,
        materialId: item.row.materialId,
        qtyBase: item.suggestQty,
        note: transfer ? ta.transferNote(formatQty(item.row.otherStockQtyBase), item.baseUnit) : null,
      }),
    })
  }

  return (
    <section aria-label={ta.runningLow} className="flex flex-col gap-2">
      <SectionTitle>{ta.runningLow}</SectionTitle>
      <ul className="flex flex-col gap-2">
        {data.data.map((item) => {
          const zero = item.row.daysLeft !== null && cmp(item.row.daysLeft, '0') <= 0
          const hasOther = cmp(item.row.otherStockQtyBase, '0') > 0
          return (
            <li
              key={`${item.row.objectId}:${item.row.materialId}`}
              data-testid="running-low"
              className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-line bg-paper py-3 pr-3 pl-4"
            >
              <span aria-hidden className={cx('absolute inset-y-2 left-0 w-1 rounded-r-full', zero ? 'bg-danger' : 'bg-warn')} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-ink">{item.materialName}</p>
                  {manyObjects && <p className="text-xs text-muted">{item.objectName}</p>}
                  <p className="tabular text-sm text-muted">{ta.stockNow(formatQty(item.row.stockQtyBase), item.baseUnit)}</p>
                  {hasOther && (
                    <p className="tabular text-xs text-muted">{ta.otherStock(formatQty(item.row.otherStockQtyBase), item.baseUnit)}</p>
                  )}
                </div>
                <span className={cx('inline-flex shrink-0 items-center gap-1 text-sm font-semibold', zero ? 'text-danger' : 'text-warn')}>
                  <Hourglass aria-hidden className="size-4" strokeWidth={2} />
                  {zero ? ta.daysLeftZero : ta.daysLeft(formatQty(item.row.daysLeft ?? '0', 1))}
                </span>
              </div>
              {canRequest && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openRequest(item, false)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-white active:brightness-95"
                  >
                    <ClipboardList aria-hidden className="size-4" strokeWidth={2} />
                    {ta.sendRequest}
                    {item.suggestQty && <span className="tabular font-normal opacity-90">· {formatQty(item.suggestQty)} {item.baseUnit}</span>}
                  </button>
                  {hasOther && (
                    <button
                      type="button"
                      onClick={() => openRequest(item, true)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 text-sm font-semibold text-brand hover:bg-ice"
                    >
                      <ArrowLeftRight aria-hidden className="size-4" strokeWidth={2} />
                      {ta.askTransfer}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
