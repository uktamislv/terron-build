// Veb "Xarid qo'shish" (ta'minotchi, admin): obyekt, material (qidiruv), birlik, miqdor, summa, sotuvchi
// (tanlash yoki yangi), sana, ixtiyoriy chek rasmi, ixtiyoriy tasdiqlangan so'rov, admin — xaridor.
// Qoidalar umumiy: narx og'ishi (check_purchase_price), rasm majburiyligi, takroriy yozuv ogohlantirishi.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/authContext'
import { Button, choiceClass, DateField, Modal, Notice, RetryNotice, SelectField, SkeletonRows, TextAreaField, TextField } from '@/components/ui'
import { DEFAULT_COMPANY_SETTINGS, getCompanySettings, type CompanySettings } from '@/data/companiesRepo'
import { requestPhotoHash } from '@/data/functions'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listActiveDirectory } from '@/data/profileDirectory'
import { checkPurchasePrice, createPurchase, listMyPurchases, type PriceCheck } from '@/data/purchasesRepo'
import { listApprovedRequests } from '@/data/requestsRepo'
import { createSupplier, listSuppliers, supplierKey } from '@/data/suppliersRepo'
import type { Material, MaterialRequest, ObjectRow, PaymentSource, PersonRef, Purchase, Supplier } from '@/data/types'
import { PAYMENT_SOURCES } from '@/data/types'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { cmp } from '@/domain/decimal'
import { entryDateBounds, tashkentDateOf } from '@/domain/entryDate'
import { can, ROLES } from '@/domain/roles'
import { findDuplicateEntry, photoRequired } from '@/domain/rules'
import { purchasePrices, toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQtyUnit, formatSum } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { PhotoField } from '@/tg/entry/PhotoPicker'
import { usePhotoDraft } from '@/tg/entry/usePhotoDraft'
import { emptyPurchaseForm, validateAddPurchase, type AddPurchaseError, type AddPurchaseField, type AddPurchaseForm } from './addPurchaseForm'
import { loadLastPurchaseObject, saveLastPurchaseObject } from './lastObject'
import { MaterialPicker } from './MaterialPicker'

const ta = t.purchases.addForm
const tm = t.tg.movement
const BUYER_ROLES = ROLES.filter((r) => can(r, 'create_purchase'))

interface Refs {
  objects: ObjectRow[]
  materials: Material[]
  suppliers: Supplier[]
  settings: CompanySettings
  buyers: PersonRef[]
  recent: Purchase[]
}

function fieldError(field: AddPurchaseField, code: AddPurchaseError | undefined): string | null {
  if (!code) return null
  if (field === 'qty') return code === 'required' ? tm.errors.qty.required : (tm.errors.qty[code as keyof typeof tm.errors.qty] ?? tm.errors.qty.out_of_range)
  if (field === 'total') return code === 'required' ? t.tg.purchase.errors.sumRequired : t.tg.purchase.errors.sumInvalid
  if (field === 'date') return code === 'required' ? t.tg.date.errRequired : tm.errors.occurredAt
  return ta.errors[field]
}

export function AddPurchaseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (p: Purchase) => void }) {
  const { profile: me } = useAuth()
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin'
  // Pul manbai — admin / super_admin / buxgalter tanlaydi (server shu rollarga ruxsat beradi)
  const canPickSource = isAdmin || me?.role === 'buxgalter'
  const [paymentSource, setPaymentSource] = useState<PaymentSource | ''>('')
  const [refs, setRefs] = useState<Refs | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<AddPurchaseForm>(() => emptyPurchaseForm(tashkentDateOf(Date.now())))
  const [errors, setErrors] = useState<Partial<Record<AddPurchaseField, AddPurchaseError>>>({})
  const [requests, setRequests] = useState<MaterialRequest[]>([])
  const [priceVerdict, setPriceVerdict] = useState<PriceCheck | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draftId] = useState(() => uuid())
  const [supplierDraftId] = useState(() => uuid())
  const photo = usePhotoDraft()
  const companyId = me?.company_id

  useEffect(() => {
    if (!companyId || !me) return
    let alive = true
    Promise.all([
      listObjects(),
      listMaterials(),
      listSuppliers(),
      getCompanySettings(companyId).catch(() => DEFAULT_COMPANY_SETTINGS),
      isAdmin ? listActiveDirectory(BUYER_ROLES) : Promise.resolve([] as PersonRef[]),
      listMyPurchases(me.id, 30).catch(() => [] as Purchase[]),
    ])
      .then(([objects, materials, suppliers, settings, buyers, recent]) => {
        if (!alive) return
        const active = objects.filter((o) => o.status === 'faol' && o.company_id === companyId)
        setRefs({
          objects: active,
          materials: materials.filter((m) => m.is_active && m.company_id === companyId),
          suppliers,
          settings,
          buyers,
          recent,
        })
        // Bitta obyekt — avtomatik; bir nechta — oxirgi tanlangani (hali faol bo'lsa)
        const last = loadLastPurchaseObject()
        const preset = active.length === 1 ? active[0]?.id : active.find((o) => o.id === last)?.id
        if (preset) setForm((f) => ({ ...f, objectId: f.objectId || preset }))
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [companyId, me, isAdmin, reloadKey])

  // Tasdiqlangan so'rovlar — tanlangan obyekt bo'yicha
  useEffect(() => {
    if (!form.objectId) return
    let alive = true
    listApprovedRequests(form.objectId)
      .then((rows) => alive && setRequests(rows))
      .catch(() => alive && setRequests([]))
    return () => {
      alive = false
    }
  }, [form.objectId])

  const material = refs?.materials.find((m) => m.id === form.materialId) ?? null
  const unit = material?.units.find((u) => u.id === form.unitId) ?? null
  const parsedQty = validateQtyInput(form.qty)
  const total = parseSumInput(form.total)
  const qtyBase = parsedQty.ok && unit ? toBaseQty(parsedQty.value, unit.factor) : null
  const pricePerBase =
    qtyBase !== null && parsedQty.ok && total !== null && cmp(total, '0') > 0 ? purchasePrices(total, parsedQty.value, qtyBase).pricePerBase : null
  const objectRequests = useMemo(
    () => requests.filter((r) => r.object_id === form.objectId && (!form.materialId || r.material_id === form.materialId)),
    [requests, form.objectId, form.materialId],
  )

  // Narx og'ishi — faqat ogohlantirish (raqamlar ko'rsatilmaydi)
  useEffect(() => {
    if (!material || pricePerBase === null) return
    let alive = true
    const timer = setTimeout(() => {
      checkPurchasePrice(material.id, pricePerBase)
        .then((v) => alive && setPriceVerdict(v))
        .catch(() => alive && setPriceVerdict(null))
    }, 400)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [material, pricePerBase])

  const rule =
    material && refs
      ? photoRequired({
          totalAmount: total,
          thresholdAmount: refs.settings.photoRequiredAmount,
          materialPhotoRequired: Boolean(material.photo_required),
          qrVerified: false,
        })
      : null
  const photoReason =
    rule === 'material' ? t.tg.auto.photoRequiredMaterial : rule === 'amount' && refs?.settings.photoRequiredAmount ? t.tg.auto.photoRequiredAmount(formatSum(refs.settings.photoRequiredAmount)) : null
  const photoMissing = photoReason !== null && !photo.photo

  const set = (patch: Partial<AddPurchaseForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setErrors((er) => {
      const next = { ...er }
      for (const k of Object.keys(patch)) {
        const field = (k === 'objectId' ? 'object' : k === 'materialId' ? 'material' : k === 'unitId' ? 'unit' : k.startsWith('supplier') ? 'supplier' : k) as AddPurchaseField
        delete next[field]
      }
      return next
    })
    setDuplicate(false)
    setSaveError(null)
    if ('materialId' in patch || 'unitId' in patch || 'qty' in patch || 'total' in patch) setPriceVerdict(null)
  }

  const pickMaterial = (id: string) => {
    const m = refs?.materials.find((x) => x.id === id)
    const base = m?.units.find((u) => u.unit === m.base_unit && !u.variant) ?? m?.units[0]
    set({ materialId: id, unitId: base?.id ?? '', requestId: '' })
  }

  const pickRequest = (id: string) => {
    const r = requests.find((x) => x.id === id)
    if (!r) {
      set({ requestId: '' })
      return
    }
    set({ requestId: r.id, materialId: r.material_id, unitId: r.unit_id, qty: form.qty || r.qty_input.replace('.', ',') })
  }

  const submit = async (e: FormEvent | null, confirmDuplicate = false) => {
    e?.preventDefault()
    if (!me || !refs || saving || photo.preparing) return
    const nowIso = new Date().toISOString()
    const result = validateAddPurchase(form, { nowIso, isAdmin })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    if (photoMissing) return
    const qb = unit ? toBaseQty(result.value.qtyInput, unit.factor) : null
    if (!confirmDuplicate && qb !== null) {
      const dup = findDuplicateEntry(
        refs.recent
          .filter((p) => !p.deleted_at && p.created_by)
          .map((p) => ({
            id: p.id,
            createdBy: p.created_by ?? '',
            kind: 'purchase',
            objectId: p.object_id,
            materialId: p.material_id,
            qtyBase: p.qty_base,
            totalAmount: p.total_amount,
            createdAt: p.created_at,
          })),
        {
          id: draftId,
          createdBy: me.id,
          kind: 'purchase',
          objectId: form.objectId,
          materialId: form.materialId,
          qtyBase: qb,
          totalAmount: result.value.totalAmount,
          createdAt: nowIso,
        },
        refs.settings.duplicateWindowMinutes,
      )
      if (dup) {
        setDuplicate(true)
        return
      }
    }
    setSaving(true)
    setSaveError(null)
    setDuplicate(false)
    try {
      let supplierId: string | null = null
      if (form.supplierMode === 'existing') supplierId = form.supplierId
      if (form.supplierMode === 'new') {
        const same = refs.suppliers.find((s) => supplierKey(s.name) === supplierKey(form.supplierName))
        supplierId = same ? same.id : (await createSupplier({ id: supplierDraftId, companyId: me.company_id, name: form.supplierName })).id
      }
      const receiptPhotoPath = await photo.resolvePath(me.company_id)
      const saved = await createPurchase({
        id: draftId,
        companyId: me.company_id,
        objectId: form.objectId,
        materialId: form.materialId,
        unitId: form.unitId,
        qtyInput: result.value.qtyInput,
        totalAmount: result.value.totalAmount,
        supplierId,
        receiptPhotoPath,
        note: form.note,
        buyerId: isAdmin && form.buyerId ? form.buyerId : me.id,
        purchasedAt: result.value.purchasedAt,
        requestId: form.requestId || null,
        ...(canPickSource && paymentSource ? { paymentSource } : {}),
      })
      // Chek rasmi xeshi — serverda, fonda (xato foydalanuvchiga ta'sir qilmaydi)
      if (receiptPhotoPath) void requestPhotoHash('purchases', saved.id)
      saveLastPurchaseObject(form.objectId)
      onSaved(saved)
    } catch (err) {
      if (!photo.handleSaveError(err)) setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const bounds = entryDateBounds(new Date().toISOString(), isAdmin)

  return (
    <Modal
      title={ta.title}
      size="lg"
      onClose={onClose}
      footer={
        refs && (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t.common.cancel}
            </Button>
            {duplicate ? (
              <Button variant="danger" loading={saving} onClick={() => void submit(null, true)}>
                {t.tg.auto.duplicateSave}
              </Button>
            ) : (
              <Button type="submit" form="add-purchase-form" loading={saving} disabled={saving || photo.preparing || photoMissing}>
                {saving ? t.common.saving : t.common.save}
              </Button>
            )}
          </>
        )
      }
    >
      {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!refs && !loadError && <SkeletonRows rows={5} />}
      {refs && (
        <form id="add-purchase-form" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <SelectField
            label={tm.object}
            value={form.objectId}
            error={fieldError('object', errors.object)}
            onChange={(v) => set({ objectId: v, requestId: '' })}
          >
            <option value="">{tm.chooseObject}</option>
            {refs.objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </SelectField>

          {objectRequests.length > 0 && (
            <SelectField label={ta.request} hint={ta.requestHint} value={form.requestId} onChange={pickRequest}>
              <option value="">{ta.requestNone}</option>
              {objectRequests.map((r) => (
                <option key={r.id} value={r.id}>
                  {`${r.material_name ?? ''} — ${formatQtyUnit(r.qty_input, unitLabel({ unit: r.unit_input, variant: r.unit_variant }))}`}
                </option>
              ))}
            </SelectField>
          )}

          <MaterialPicker materials={refs.materials} value={form.materialId || null} onChange={pickMaterial} error={fieldError('material', errors.material)} />

          {material && (
            <fieldset className="flex flex-col gap-2" aria-describedby={errors.unit ? 'add-purchase-unit-error' : undefined}>
              <legend className="mb-1 text-sm font-medium text-ink">{tm.unit}</legend>
              <div className="flex flex-wrap gap-2">
                {material.units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    aria-pressed={form.unitId === u.id}
                    className={choiceClass({ selected: form.unitId === u.id })}
                    onClick={() => set({ unitId: u.id })}
                  >
                    {unitLabel(u)}
                  </button>
                ))}
              </div>
              {errors.unit && (
                <p id="add-purchase-unit-error" role="alert" className="text-xs text-danger">
                  {fieldError('unit', errors.unit)}
                </p>
              )}
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={tm.qty}
              inputMode="decimal"
              autoComplete="off"
              value={form.qty}
              error={fieldError('qty', errors.qty)}
              hint={qtyBase !== null && material && unit && unit.unit !== material.base_unit ? tm.equals(formatQtyUnit(qtyBase, null), material.base_unit) : undefined}
              onChange={(e) => set({ qty: e.target.value })}
            />
            <TextField
              label={t.tg.purchase.sum}
              inputMode="numeric"
              autoComplete="off"
              value={form.total}
              suffix={t.ui.sum}
              error={fieldError('total', errors.total)}
              hint={pricePerBase !== null && material ? t.tg.purchase.perBase(material.base_unit, formatSum(pricePerBase)) : undefined}
              onChange={(e) => set({ total: formatSumInput(e.target.value) })}
            />
          </div>
          {priceVerdict === 'high' && <Notice tone="warn">{t.tg.purchase.priceHigh}</Notice>}
          {priceVerdict === 'low' && <Notice tone="warn">{t.tg.purchase.priceLow}</Notice>}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={ta.supplier}
              value={form.supplierMode === 'existing' ? form.supplierId : form.supplierMode === 'new' ? '__new' : ''}
              error={form.supplierMode !== 'new' ? fieldError('supplier', errors.supplier) : null}
              onChange={(v) =>
                v === '__new'
                  ? set({ supplierMode: 'new', supplierId: '' })
                  : v
                    ? set({ supplierMode: 'existing', supplierId: v, supplierName: '' })
                    : set({ supplierMode: 'none', supplierId: '', supplierName: '' })
              }
            >
              <option value="">{t.tg.purchase.supplierClear}</option>
              {refs.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="__new">{`+ ${t.tg.purchase.supplierNew}`}</option>
            </SelectField>
            {form.supplierMode === 'new' && (
              <TextField
                label={t.tg.purchase.supplierName}
                placeholder={t.tg.purchase.supplierNamePlaceholder}
                autoComplete="off"
                value={form.supplierName}
                error={fieldError('supplier', errors.supplier)}
                onChange={(e) => set({ supplierName: e.target.value })}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              label={ta.date}
              value={form.date}
              min={bounds.min}
              max={bounds.max}
              hint={isAdmin ? undefined : t.tg.date.pickHint}
              error={fieldError('date', errors.date)}
              onChange={(iso) => set({ date: iso })}
            />
            {isAdmin && (
              <SelectField label={ta.buyer} hint={ta.buyerHint} value={form.buyerId} onChange={(v) => set({ buyerId: v })}>
                <option value="">{ta.buyerMe}</option>
                {refs.buyers
                  .filter((b) => b.id !== me?.id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {`${b.full_name} (${t.roles[b.role]})`}
                    </option>
                  ))}
              </SelectField>
            )}
          </div>

          {canPickSource && (
            <SelectField
              label={ta.paymentSource}
              hint={ta.paymentSourceHint}
              value={paymentSource}
              onChange={(v) => setPaymentSource(v === 'podotchet' || v === 'firma' ? v : '')}
            >
              <option value="">{ta.paymentSourceAuto}</option>
              {PAYMENT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t.purchases.paymentSources[s]}
                </option>
              ))}
            </SelectField>
          )}

          <PhotoField
            label={t.tg.purchase.photo}
            photo={photo.photo}
            busy={photo.preparing || saving}
            preparing={photo.preparing}
            notice={photo.notice}
            requiredReason={photoReason}
            onPick={(f) => void photo.pick(f)}
            onRemove={photo.remove}
          />
          {photoMissing && <Notice tone="warn">{photoReason}</Notice>}
          {photo.error && <Notice>{photo.error}</Notice>}

          <TextAreaField label={t.tg.purchase.note} placeholder={t.tg.purchase.notePlaceholder} value={form.note} onChange={(e) => set({ note: e.target.value })} />

          {duplicate && <Notice tone="warn">{t.tg.auto.duplicateText(refs.settings.duplicateWindowMinutes)}</Notice>}
          {saveError && <Notice>{saveError}</Notice>}
        </form>
      )}
    </Modal>
  )
}
