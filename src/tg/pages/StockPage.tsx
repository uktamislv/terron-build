// Telegram ilovasi "Qoldiq" (prorab, omborchi, admin) — bosh ekrandan ochiladi. Obyekt bo'yicha qoldiq,
// qidiruv va prognoz (necha kunga yetadi, tugayotganlar ajratilgan). Faqat ko'rish.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Hourglass, Package } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { choiceClass, cx, EmptyState, EntryRow, Notice, Qty, RetryNotice, SearchBox, SkeletonRows } from '@/components/ui'
import { getStockForecast, type StockForecastRow } from '@/data/forecastRepo'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listStock } from '@/data/stockRepo'
import type { Material, ObjectRow, StockBalance } from '@/data/types'
import { cmp } from '@/domain/decimal'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty, formatQtyUnit } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { orderObjects } from '../entry/objects'
import { useCompanySettings } from '../entry/useCompanySettings'
import { loadLastObject, saveEntryType } from '../movement/prefs'
import { makeMovementPrefillState } from '../movement/prefill'
import { loadLastEntry } from '../entry/lastEntry'
import { buildStockList } from '../stock/stockList'
import { haptic } from '../telegram'
import { useBackButton } from '../useTelegramButtons'

const ts = t.tg.stock
const ta = t.tg.auto

export function StockPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const companyId = profile?.company_id
  const profileId = profile?.id
  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [objectId, setObjectId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const settings = useCompanySettings(companyId)
  const back = useCallback(() => navigate('/tg'), [navigate])
  useBackButton(back)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    Promise.all([listObjects(), listMaterials()])
      .then(([objs, mats]) => {
        if (!alive) return
        const active = orderObjects(
          objs.filter((o) => o.status === 'faol' && o.company_id === companyId),
          loadLastObject(),
        )
        setObjects(active)
        setMaterials(mats.filter((m) => m.company_id === companyId))
        setObjectId((cur) => cur ?? active[0]?.id ?? null)
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [companyId, reloadKey])

  const data = useLoad(
    async (): Promise<{ stock: StockBalance[]; forecast: StockForecastRow[] }> => {
      const id = objectId ?? ''
      // Prognoz — qo'shimcha: xato bo'lsa qoldiq baribir ko'rsatiladi
      const [stock, forecast] = await Promise.all([listStock({ objectId: id }), getStockForecast(id).catch(() => [])])
      return { stock, forecast }
    },
    `${objectId ?? ''}#${reloadKey}`,
    Boolean(objectId),
  )

  const items = useMemo(
    () =>
      data.data && materials
        ? buildStockList(data.data.stock, data.data.forecast, materials, query, settings.forecastDaysWarn, (materialId) =>
            profileId ? (loadLastEntry(profileId, materialId)?.unitId ?? null) : null,
          )
        : null,
    [data.data, materials, query, settings.forecastDaysWarn, profileId],
  )
  const lowCount = items?.filter((i) => i.low).length ?? 0

  if (!profile) return null
  // Qator bosilsa — shu material bilan chiqim formasi (faqat yozuv kirita oladiganlarga; direktor — faqat ko'rish)
  const canWrite = can(profile.role, 'create_movement')
  const openChiqim = (materialId: string) => {
    if (!objectId) return
    haptic.tap()
    saveEntryType('chiqim')
    navigate('/tg/movement', { state: makeMovementPrefillState({ type: 'chiqim', objectId, materialId }) })
  }
  const single = objects && objects.length === 1 ? objects[0] : null

  return (
    <div className="flex flex-col gap-4">
      {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!loadError && !objects && <SkeletonRows rows={3} />}
      {objects && objects.length === 0 && <Notice tone="warn">{t.tg.movement.noObjects}</Notice>}
      {single && (
        <p className="flex min-h-11 items-center gap-2 text-base font-semibold text-ink" data-testid="stock-object">
          <Building2 aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
          {single.name}
        </p>
      )}
      {objects && objects.length > 1 && (
        <div role="group" aria-label={t.tg.movement.object} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {objects.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={o.id === objectId}
              className={choiceClass({ selected: o.id === objectId, size: 'md' })}
              onClick={() => {
                haptic.select()
                setObjectId(o.id)
              }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
      {objectId && (
        <>
          <SearchBox label={t.tg.movement.search} value={query} onChange={setQuery} placeholder={t.tg.movement.search} />
          {data.error && <RetryNotice message={data.error} onRetry={data.reload} />}
          {(data.loading || (!items && !data.error)) && <SkeletonRows rows={4} />}
          {items && lowCount > 0 && <Notice tone="warn">{ts.lowCount(lowCount)}</Notice>}
          {items && items.length === 0 && (
            <EmptyState icon={<Package strokeWidth={1.5} />} title={query ? t.tg.movement.notFound : ts.empty} />
          )}
          {items && items.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label={ts.title}>
              {items.map((i) => {
                const zero = i.daysLeft !== null && cmp(i.daysLeft, '0') <= 0
                return (
                  <EntryRow
                    key={i.materialId}
                    as="li"
                    testId="stock-item"
                    kind={i.negative ? 'danger' : i.low ? 'warn' : 'neutral'}
                    icon={false}
                    title={i.name}
                    onClick={canWrite ? () => openChiqim(i.materialId) : undefined}
                    meta={
                      i.negative ? (
                        <span className="font-medium text-danger">{t.ombor.negative}</span>
                      ) : i.empty ? (
                        <span className="inline-flex items-center gap-1 font-medium text-warn">
                          <Hourglass aria-hidden className="size-3.5" strokeWidth={2} />
                          {ta.daysLeftZero}
                        </span>
                      ) : i.daysLeft !== null ? (
                        <span className={cx('inline-flex items-center gap-1', i.low ? 'font-medium text-warn' : 'text-muted')}>
                          <Hourglass aria-hidden className="size-3.5" strokeWidth={2} />
                          {zero ? ta.daysLeftZero : ta.daysLeft(formatQty(i.daysLeft, 1))}
                        </span>
                      ) : undefined
                    }
                    // Odatiy kiritish birligida ("12 qop"), ostida asosiy birlikda ("(600 kg)")
                    trailing={i.inputView ? <Qty value={i.inputView.qty} unit={i.inputView.unit} /> : <Qty value={i.qtyBase} unit={i.baseUnit} />}
                    trailingMeta={i.inputView ? <span className="tabular">{ts.inBase(formatQtyUnit(i.qtyBase, i.baseUnit))}</span> : undefined}
                  />
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
