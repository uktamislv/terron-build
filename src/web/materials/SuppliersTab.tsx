// "Sotuvchilar" (Materiallar ichida, admin): ro'yxat, qidiruv, tahrirlash (nom, telefon, STIR, izoh),
// birlashtirish (merge_suppliers, tasdiq bilan), o'chirish va tiklash.
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { Merge, Pencil, RotateCcw, Store, Trash2 } from 'lucide-react'
import {
  ActionMenu,
  Badge,
  Button,
  choiceClass,
  cx,
  DataTable,
  EmptyState,
  EntryRow,
  FilterBar,
  Modal,
  Notice,
  RetryNotice,
  SearchBox,
  SkeletonRows,
  TextAreaField,
  TextField,
} from '@/components/ui'
import { countPurchasesBySupplier, listAllSuppliers, mergeSuppliers, restoreSupplier, softDeleteSupplier, updateSupplier } from '@/data/suppliersRepo'
import type { Supplier } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { useLoad } from '@/lib/useLoad'
import { filterSuppliers } from './supplierFilter'

const ts = t.suppliers
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

type Dialog = { kind: 'edit'; supplier: Supplier } | { kind: 'merge'; supplier: Supplier } | { kind: 'delete'; supplier: Supplier } | null

export function SuppliersTab() {
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const list = useLoad(() => listAllSuppliers(includeDeleted), `suppliers:${includeDeleted}`)
  const reload = list.reload
  const close = useCallback(() => setDialog(null), [])
  const rows = useMemo(() => (list.data ? filterSuppliers(list.data, query) : null), [list.data, query])
  const live = useMemo(() => (list.data ?? []).filter((s) => !s.deleted_at), [list.data])

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setActionError(null)
    try {
      setDone(await action())
      setDialog(null)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const actions = (s: Supplier) => (
    <ActionMenu
      items={[
        !s.deleted_at && { key: 'edit', label: t.common.edit, icon: <Pencil {...ic} />, onSelect: () => open({ kind: 'edit', supplier: s }) },
        !s.deleted_at && live.length > 1 && { key: 'merge', label: ts.merge, icon: <Merge {...ic} />, onSelect: () => open({ kind: 'merge', supplier: s }) },
        Boolean(s.deleted_at) && {
          key: 'restore',
          label: ts.restore,
          icon: <RotateCcw {...ic} />,
          disabled: busy,
          onSelect: () => void run(() => restoreSupplier(s.id).then(() => ts.restored(s.name))),
        },
        !s.deleted_at && { key: 'delete', label: ts.delete, icon: <Trash2 {...ic} />, danger: true, onSelect: () => open({ kind: 'delete', supplier: s }) },
      ]}
    />
  )
  const open = (d: Dialog) => {
    setActionError(null)
    setDone(null)
    setDialog(d)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{ts.intro}</p>
      <FilterBar
        label={ts.title}
        filters={[
          { kind: 'search', key: 'q', label: ts.search, placeholder: ts.searchPlaceholder, value: query, onChange: setQuery },
          { kind: 'toggle', key: 'deleted', label: ts.showDeleted, checked: includeDeleted, onChange: setIncludeDeleted },
        ]}
        onClear={() => {
          setQuery('')
          setIncludeDeleted(false)
        }}
      />
      {done && <Notice tone="ok">{done}</Notice>}
      {actionError && !dialog && <Notice>{actionError}</Notice>}
      {list.error && <RetryNotice message={list.error} onRetry={reload} />}
      {list.loading && <SkeletonRows rows={4} />}
      {rows && (
        <DataTable
          caption={ts.title}
          rows={rows}
          rowKey={(s) => s.id}
          rowTestId="supplier-row"
          rowClassName={(s) => (s.deleted_at ? 'bg-canvas/60 text-muted' : undefined)}
          empty={<EmptyState icon={<Store strokeWidth={1.5} />} title={query ? ts.notFound : ts.empty} />}
          columns={[
            {
              key: 'name',
              header: ts.colName,
              cell: (s) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span className={s.deleted_at ? 'line-through' : 'font-medium text-ink'}>{s.name}</span>
                  {s.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
                </span>
              ),
            },
            { key: 'phone', header: ts.colPhone, cell: (s) => <span className="tabular">{s.phone ?? '—'}</span> },
            { key: 'tin', header: ts.colTin, cell: (s) => <span className="tabular">{s.tin ?? '—'}</span> },
            { key: 'note', header: ts.colNote, cell: (s) => <span className="text-muted">{s.note ?? ''}</span> },
            { key: 'actions', header: ts.colActions, cell: actions },
          ]}
          renderMobile={(s) => (
            <EntryRow
              kind="neutral"
              icon={<Store className="size-5" strokeWidth={1.75} />}
              deleted={Boolean(s.deleted_at)}
              title={s.name}
              badge={s.deleted_at ? <Badge tone="danger">{t.movements.deleted}</Badge> : null}
              meta={
                <>
                  {s.phone && <span className="tabular">{s.phone}</span>}
                  {s.tin && <span className="tabular">{ts.tinShort(s.tin)}</span>}
                  {s.note && <span>{s.note}</span>}
                </>
              }
              actions={actions(s)}
            />
          )}
        />
      )}

      {dialog?.kind === 'edit' && (
        <EditSupplierDialog
          supplier={dialog.supplier}
          busy={busy}
          error={actionError}
          onClose={close}
          onSave={(patch) => void run(() => updateSupplier(dialog.supplier.id, patch).then(() => ts.saved))}
        />
      )}
      {dialog?.kind === 'merge' && (
        <MergeDialog
          supplier={dialog.supplier}
          candidates={live.filter((s) => s.id !== dialog.supplier.id)}
          busy={busy}
          error={actionError}
          onClose={close}
          onMerge={(keepId) =>
            void run(async () => {
              const moved = await mergeSuppliers(keepId, dialog.supplier.id)
              const keep = live.find((s) => s.id === keepId)
              return ts.merged(dialog.supplier.name, keep?.name ?? '', moved)
            })
          }
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal
          title={ts.delete}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {t.common.cancel}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => void run(() => softDeleteSupplier(dialog.supplier.id).then(() => ts.deleted(dialog.supplier.name)))}
              >
                {ts.delete}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{ts.deleteConfirm(dialog.supplier.name)}</p>
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </div>
  )
}

function EditSupplierDialog({
  supplier,
  busy,
  error,
  onClose,
  onSave,
}: {
  supplier: Supplier
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (patch: { name: string; phone: string; tin: string; note: string }) => void
}) {
  const [name, setName] = useState(supplier.name)
  const [phone, setPhone] = useState(supplier.phone ?? '')
  const [tin, setTin] = useState(supplier.tin ?? '')
  const [note, setNote] = useState(supplier.note ?? '')
  const [errors, setErrors] = useState<{ name?: boolean; tin?: boolean }>({})
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const digits = tin.replace(/\D/g, '')
    const next = { name: !name.trim(), tin: tin.trim() !== '' && (digits.length < 9 || digits.length > 14) }
    setErrors(next)
    if (next.name || next.tin) return
    onSave({ name, phone, tin, note })
  }
  return (
    <Modal
      title={ts.editTitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="supplier-form" loading={busy}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="supplier-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField label={ts.colName} value={name} autoComplete="off" error={errors.name ? ts.errName : null} onChange={(e) => setName(e.target.value)} />
        <TextField label={ts.colPhone} type="tel" inputMode="tel" value={phone} autoComplete="off" onChange={(e) => setPhone(e.target.value)} />
        <TextField
          label={ts.colTin}
          inputMode="numeric"
          value={tin}
          autoComplete="off"
          hint={ts.tinHint}
          error={errors.tin ? ts.errTin : null}
          onChange={(e) => setTin(e.target.value)}
        />
        <TextAreaField label={ts.colNote} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Notice>{error}</Notice>}
      </form>
    </Modal>
  )
}

function MergeDialog({
  supplier,
  candidates,
  busy,
  error,
  onClose,
  onMerge,
}: {
  supplier: Supplier
  candidates: Supplier[]
  busy: boolean
  error: string | null
  onClose: () => void
  onMerge: (keepId: string) => void
}) {
  const [keepId, setKeepId] = useState('')
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState(false)
  // Xaridlar soni — qo'shimcha: yuklanmasa ro'yxat baribir ishlaydi (son ko'rsatilmaydi)
  const counts = useLoad(() => countPurchasesBySupplier(), `supplier-counts:${supplier.id}`)
  const keep = candidates.find((s) => s.id === keepId) ?? null
  const shown = useMemo(() => filterSuppliers(candidates, query), [candidates, query])
  const moving = counts.data?.get(supplier.id) ?? 0
  const countOf = (id: string) => (counts.data ? ts.purchaseCount(counts.data.get(id) ?? 0) : null)
  return (
    <Modal
      title={ts.mergeTitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={confirming ? () => setConfirming(false) : onClose}>
            {confirming ? t.common.back : t.common.cancel}
          </Button>
          {confirming ? (
            <Button variant="danger" loading={busy} onClick={() => keep && onMerge(keep.id)}>
              {ts.mergeConfirm(moving)}
            </Button>
          ) : (
            <Button disabled={!keep} onClick={() => setConfirming(true)}>
              {ts.mergeNext}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{ts.mergeIntro(supplier.name)}</p>
        {!confirming && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">{ts.mergeInto}</legend>
            <SearchBox label={ts.mergeSearch} placeholder={ts.searchPlaceholder} value={query} onChange={setQuery} size="md" />
            {shown.length === 0 ? (
              <p className="text-sm text-muted">{ts.mergeNone}</p>
            ) : (
              <div role="radiogroup" aria-label={ts.mergeInto} className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {shown.map((s) => (
                  <label
                    key={s.id}
                    data-testid="merge-target"
                    className={cx(choiceClass({ selected: keepId === s.id, shape: 'row', label: true, emphasis: false }), 'justify-between')}
                  >
                    <input type="radio" name="merge-target" className="sr-only" checked={keepId === s.id} onChange={() => setKeepId(s.id)} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{s.name}</span>
                      {s.tin && <span className="tabular text-xs text-muted">{ts.tinShort(s.tin)}</span>}
                    </span>
                    {countOf(s.id) && <span className="tabular shrink-0 text-xs text-muted">{countOf(s.id)}</span>}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {confirming && keep && <Notice tone="warn">{ts.mergeWarning(supplier.name, keep.name, moving)}</Notice>}
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}
