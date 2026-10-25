import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Notice, Spinner, TextField } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import type { Material } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { MaterialDetailDialog } from '../materials/MaterialDetailDialog'
import { MaterialFormDialog } from '../materials/MaterialFormDialog'
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
  const categoryId = useId()
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [active, setActive] = useState<ActiveFilter>('active')

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

  if (!me) return null
  const canManage = can(me.role, 'manage_catalog')
  const current = dialog && dialog.kind !== 'create' ? materials?.find((m) => m.id === dialog.id) : undefined

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{tm.title}</h1>
        {canManage && <Button onClick={() => setDialog({ kind: 'create' })}>{tm.add}</Button>}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-end">
        <TextField
          className="flex-1"
          type="search"
          label={tm.search}
          placeholder={tm.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-col gap-1.5 md:w-56">
          <label htmlFor={categoryId} className="text-sm font-medium text-slate-700">
            {tm.category}
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
          >
            <option value="">{tm.allCategories}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={NO_CATEGORY}>{tm.noCategory}</option>
          </select>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{tm.statusFilter}</legend>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {ACTIVE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={active === f}
                onClick={() => setActive(f)}
                className={`min-h-11 rounded-lg px-3 text-sm font-medium ${
                  active === f ? 'bg-white text-brand shadow-sm' : 'text-slate-600'
                }`}
              >
                {tm.filters[f]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {error && (
        <Notice>
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={reload}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!materials && !error && <Spinner />}
      {materials && materials.length === 0 && <p className="text-slate-600">{tm.empty}</p>}
      {materials && materials.length > 0 && visible.length === 0 && <p className="text-slate-600">{tm.notFound}</p>}

      {visible.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" aria-label={tm.title}>
          {visible.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'view', id: m.id })}
                className="flex h-full min-h-11 w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-brand/40 hover:bg-brand-light/30"
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{m.name}</p>
                    <p className="text-sm text-slate-600">{m.category ?? tm.noCategory}</p>
                  </div>
                  <StatusBadge tone={m.is_active ? 'ok' : 'warn'}>{m.is_active ? tm.active : tm.inactive}</StatusBadge>
                </div>
                <p className="text-sm text-slate-500">
                  {m.base_unit} · {tm.wasteShort} {formatQty(m.waste_pct, 2)}% · {m.units.length} {tm.unitsCount}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'create' && (
        <MaterialFormDialog
          companyId={me.company_id}
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
          companyId={me.company_id}
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
