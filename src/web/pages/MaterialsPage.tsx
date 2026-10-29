import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Camera, FileMinus, Layers, Package, Percent, Plus, Ruler, SearchX, Store } from 'lucide-react'
import { useCompanyId } from '@/auth/activeCompany'
import { useAuth } from '@/auth/authContext'
import { Badge, Button, EmptyState, FilterBar, PageHeader, RetryNotice, SegmentedControl, SkeletonRows, Tabs } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import type { Material } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatQty } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { materialsSheets } from '../exports'
import { MaterialDetailDialog } from '../materials/MaterialDetailDialog'
import { MaterialFormDialog } from '../materials/MaterialFormDialog'
import { SuppliersTab } from '../materials/SuppliersTab'
import {
  ACTIVE_FILTERS,
  categoriesOf,
  filterMaterials,
  NO_CATEGORY,
  type ActiveFilter,
} from '../materials/materialFilter'

const tm = t.materials

type Dialog = { kind: 'create' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string } | null

export function MaterialsPage() {
  const { profile: me } = useAuth()
  // super_admin — faol firma (yon menyudagi tanlagich), boshqalar — o'z firmasi
  const companyId = useCompanyId()
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [active, setActive] = useState<ActiveFilter>('active')
  // Admin: "Sotuvchilar" bo'limi (?tab=suppliers)
  const [params, setParams] = useSearchParams()

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listMaterials()
      .then((list) => {
        if (!alive) return
        setMaterials(list)
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  const categories = useMemo(() => categoriesOf(materials ?? []), [materials])
  const visible = useMemo(
    () => filterMaterials(materials ?? [], { query, category, active }),
    [materials, query, category, active],
  )

  if (!me || !companyId) return null
  const canManage = can(me.role, 'manage_catalog')
  const current = dialog && dialog.kind !== 'create' ? materials?.find((m) => m.id === dialog.id) : undefined
  const tab: 'materials' | 'suppliers' = canManage && params.get('tab') === 'suppliers' ? 'suppliers' : 'materials'
  const tabIcon = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

  if (tab === 'suppliers') {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={tm.title} icon={<Package strokeWidth={1.75} />} />
        <Tabs
          label={t.suppliers.tabsLabel}
          items={[
            { key: 'materials', label: t.suppliers.tabMaterials, icon: <Package {...tabIcon} /> },
            { key: 'suppliers', label: t.suppliers.title, icon: <Store {...tabIcon} /> },
          ]}
          value={tab}
          onChange={(next) => setParams(next === 'suppliers' ? { tab: 'suppliers' } : {}, { replace: true })}
        />
        <SuppliersTab />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tm.title}
        icon={<Package strokeWidth={1.75} />}
        actions={
          <>
            {materials && materials.length > 0 && (
              <ExportButton
                run={async (signal) => {
                  await exportWorkbook({ fileName: exportFileName(t.excel.sections.materials), sheets: materialsSheets(visible), signal })
                }}
              />
            )}
            {canManage && (
              <Button icon={<Plus aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setDialog({ kind: 'create' })}>
                {tm.add}
              </Button>
            )}
          </>
        }
      />

      {canManage && (
        <Tabs
          label={t.suppliers.tabsLabel}
          items={[
            { key: 'materials', label: t.suppliers.tabMaterials, icon: <Package {...tabIcon} /> },
            { key: 'suppliers', label: t.suppliers.title, icon: <Store {...tabIcon} /> },
          ]}
          value={tab}
          onChange={(next) => setParams(next === 'suppliers' ? { tab: 'suppliers' } : {}, { replace: true })}
        />
      )}

      <FilterBar
        filters={[
          { kind: 'search', key: 'q', label: tm.search, placeholder: tm.searchPlaceholder, value: query, onChange: setQuery },
          {
            kind: 'select',
            key: 'category',
            label: tm.category,
            value: category,
            onChange: setCategory,
            options: [
              { value: '', label: tm.allCategories },
              ...categories.map((c) => ({ value: c, label: c })),
              { value: NO_CATEGORY, label: tm.noCategory },
            ],
          },
        ]}
        // Qidiruv va holat filtri ham standart holatga qaytadi
        onClear={() => {
          setCategory('')
          setQuery('')
          setActive('active')
        }}
        extra={
          <SegmentedControl
            label={tm.statusFilter}
            value={active}
            onChange={setActive}
            className="min-w-64 shrink-0"
            options={ACTIVE_FILTERS.map((f) => ({ value: f, label: tm.filters[f] }))}
          />
        }
      />

      {error && <RetryNotice message={error} onRetry={reload} />}
      {!materials && !error && <SkeletonRows rows={4} />}
      {materials && materials.length === 0 && (
        <EmptyState
          icon={<Package strokeWidth={1.5} />}
          title={tm.empty}
          action={
            canManage && (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'create' })}>
                {tm.add}
              </Button>
            )
          }
        />
      )}
      {materials && materials.length > 0 && visible.length === 0 && <EmptyState icon={<SearchX strokeWidth={1.5} />} title={tm.notFound} />}

      {visible.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={tm.title}>
          {visible.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'view', id: m.id })}
                className="group flex h-full min-h-11 w-full items-start gap-3 rounded-xl border border-line bg-paper p-4 text-left transition-colors hover:border-brand/40 hover:bg-ice/30"
              >
                <span
                  aria-hidden
                  className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${m.is_active ? 'bg-ice text-brand' : 'bg-canvas text-muted'}`}
                >
                  <Package className="size-5" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{m.name}</span>
                      <span className="block text-sm text-muted">{m.category ?? tm.noCategory}</span>
                    </span>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {m.photo_required && (
                        <Badge tone="info" icon={<Camera aria-hidden className="size-3.5" strokeWidth={2} />}>
                          {tm.photoRequired}
                        </Badge>
                      )}
                      {m.outside_estimate && (
                        <Badge tone="neutral" icon={<FileMinus aria-hidden className="size-3.5" strokeWidth={2} />}>
                          {tm.outsideEstimate}
                        </Badge>
                      )}
                      <Badge tone={m.is_active ? 'ok' : 'warn'}>{m.is_active ? tm.active : tm.inactive}</Badge>
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <Ruler aria-hidden className="size-4" strokeWidth={1.75} />
                      <span className="font-medium text-ink">{m.base_unit}</span>
                    </span>
                    <span className="tabular inline-flex items-center gap-1.5">
                      <Percent aria-hidden className="size-4" strokeWidth={1.75} />
                      {tm.wasteShort} {formatQty(m.waste_pct, 2)}%
                    </span>
                    <span className="tabular inline-flex items-center gap-1.5">
                      <Layers aria-hidden className="size-4" strokeWidth={1.75} />
                      {m.units.length} {tm.unitsCount}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'create' && (
        <MaterialFormDialog
          companyId={companyId}
          materials={materials ?? []}
          categories={categories}
          onClose={closeDialog}
          onSaved={(id) => {
            setDialog({ kind: 'view', id })
            reload()
          }}
        />
      )}
      {dialog?.kind === 'edit' && current && (
        <MaterialFormDialog
          companyId={companyId}
          materials={materials ?? []}
          material={current}
          categories={categories}
          onClose={() => setDialog({ kind: 'view', id: current.id })}
          onSaved={(id) => {
            setDialog({ kind: 'view', id })
            reload()
          }}
        />
      )}
      {dialog?.kind === 'view' && current && (
        <MaterialDetailDialog
          material={current}
          materials={materials ?? []}
          canManage={canManage}
          onClose={closeDialog}
          onEdit={() => setDialog({ kind: 'edit', id: current.id })}
          onChanged={reload}
          onDeleted={() => {
            closeDialog()
            reload()
          }}
        />
      )}
    </div>
  )
}
