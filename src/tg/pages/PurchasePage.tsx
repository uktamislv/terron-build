import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { Notice, PageHeader, SkeletonRows } from '@/components/ui'
import { getMyBalance } from '@/data/cashRepo'
import { errorCodeOf } from '@/data/errors'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { checkPurchasePrice, createPurchase, type PriceCheck } from '@/data/purchasesRepo'
import { createSupplier, listSuppliers, supplierKey } from '@/data/suppliersRepo'
import type { Material, ObjectRow, Supplier } from '@/data/types'
import { getMyMaterialUsage } from '@/data/usageRepo'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { cmp, isZero, round } from '@/domain/decimal'
import { defaultObjectId, rankMaterials, validateMovementDraft, type UsageStat } from '@/domain/movements'
import { purchasePrices, toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty, formatSum } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { MaterialGrid } from '../entry/MaterialGrid'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { usePhotoDraft } from '../entry/usePhotoDraft'
import { loadLastObject, saveLastObject } from '../movement/prefs'
import { loadRecentSuppliers, rememberSupplier } from '../purchase/prefs'
import { BalanceCard, PurchaseDetails, type PurchaseFieldErrors } from '../purchase/PurchaseDetails'
import type { SupplierChoice } from '../purchase/SupplierPicker'
import { getWebApp, haptic } from '../telegram'
import { LoadError, SavedBanner } from '../ui'
import { useBackButton, useMainButton } from '../useTelegramButtons'

const tm = t.tg.movement
const tp = t.tg.purchase
const USAGE_DAYS = 30
const PRICE_CHECK_DELAY_MS = 400

type Step = 'object' | 'material' | 'details'
type QtyErrorKey = keyof typeof tm.errors.qty
type FieldErrors = PurchaseFieldErrors

/** Kursordan oldingi "muhim" belgilar (raqam, vergul, nuqta) soni — formatlashdan keyin kursorni tiklash uchun. */
function caretAfterFormat(raw: string, caret: number, formatted: string): number {
  const significant = raw.slice(0, caret).replace(/[^\d.,]/g, '').length
  let pos = 0
  let seen = 0
  while (pos < formatted.length && seen < significant) {
    if (/[\d.,]/.test(formatted.charAt(pos))) seen++
    pos++
  }
  return pos
}

/** Oxirgi ishlatilgan sotuvchilar birinchi, qolganlari nom bo'yicha. */
function orderSuppliers(list: Supplier[], recent: string[]): Supplier[] {
  const rank = (s: Supplier) => {
    const i = recent.indexOf(s.id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'uz'))
}

export function PurchasePage() {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  const profileId = profile?.id

  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [balance, setBalance] = useState<{ value: string | null; failed: boolean } | null>(null)
  const [balanceKey, setBalanceKey] = useState(0)

  const [objectId, setObjectId] = useState<string | null>(null)
  const [pickingObject, setPickingObject] = useState(false)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [sum, setSum] = useState('')
  const [note, setNote] = useState('')
  const [supplier, setSupplier] = useState<SupplierChoice>({ kind: 'none' })
  const [priceCheck, setPriceCheck] = useState<{ key: string; result: PriceCheck } | null>(null)
  const photo = usePhotoDraft()
  const preparingPhoto = photo.preparing
  const clearPhotoError = photo.clearError

  // Qoralama id'lari — qayta urinishda ikki marta yozilmasin (baza 23505 → saqlangan qator o'qiladi)
  const [draftId, setDraftId] = useState<string>(() => uuid())
  const [supplierDraftId, setSupplierDraftId] = useState<string>(() => uuid())

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)

  const sumRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    Promise.all([listObjects(), listMaterials()])
      .then(([objs, mats]) => {
        if (!alive) return
        // super_admin boshqa firmalarni ham ko'radi — Mini App faqat o'z firmasida ishlaydi
        const active = objs.filter((o) => o.status === 'faol' && o.company_id === companyId)
        setObjects(active)
        setMaterials(mats.filter((m) => m.is_active && m.company_id === companyId))
        setObjectId((cur) => cur ?? defaultObjectId(active.map((o) => o.id), loadLastObject()))
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(errorText(err))
      })
    // Qo'shimcha ma'lumotlar — bo'lmasa ham ekran ishlaydi
    listSuppliers()
      .then((list) => alive && setSuppliers(list.filter((s) => s.company_id === companyId)))
      .catch(() => undefined)
    getMyMaterialUsage(USAGE_DAYS)
      .then((rows) => alive && setUsage(rows))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [companyId, reloadKey])

  useEffect(() => {
    if (!companyId || !profileId) return
    let alive = true
    getMyBalance(companyId, profileId)
      .then((b) => alive && setBalance({ value: b.balance, failed: false }))
      .catch(() => alive && setBalance({ value: null, failed: true }))
    return () => {
      alive = false
    }
  }, [companyId, profileId, balanceKey])

  // Summa formatlangandan keyin kursor joyida qolsin
  useLayoutEffect(() => {
    const el = sumRef.current
    const pos = caretRef.current
    caretRef.current = null
    if (el && pos !== null && document.activeElement === el) el.setSelectionRange(pos, pos)
  }, [sum])

  const ranked = useMemo(
    () => (materials ? rankMaterials(materials, usage, new Date().toISOString()) : []),
    [materials, usage],
  )
  const orderedSuppliers = useMemo(() => orderSuppliers(suppliers, loadRecentSuppliers()), [suppliers])

  const material = materials?.find((m) => m.id === materialId) ?? null
  const unit = material?.units.find((u) => u.id === unitId) ?? null
  const object = objects?.find((o) => o.id === objectId) ?? null
  const manyObjects = (objects?.length ?? 0) > 1
  const step: Step = (!objectId || pickingObject) && manyObjects ? 'object' : !material ? 'material' : 'details'

  // Jonli narx: "1 kg narxi: …" va oxirgi o'rtachadan og'ish (bloklamaydi)
  const parsedQty = validateQtyInput(qty)
  const sumDec = parseSumInput(sum)
  const qtyBase = parsedQty.ok && unit ? toBaseQty(parsedQty.value, unit.factor) : null
  const pricePerBase =
    parsedQty.ok && qtyBase !== null && !isZero(qtyBase) && sumDec !== null && !isZero(sumDec)
      ? purchasePrices(sumDec, parsedQty.value, qtyBase).pricePerBase
      : null

  // Narx tekshiruvi serverda (RPC): faqat 'ok' | 'high' | 'low' — foiz va o'rtacha ko'rsatilmaydi.
  // Yozish paytida har tugmada emas — 400 ms tinchlikdan keyin.
  const priceKey = materialId && pricePerBase !== null ? `${materialId}:${pricePerBase}` : null
  useEffect(() => {
    if (!priceKey || !materialId || pricePerBase === null) return
    let alive = true
    const timer = window.setTimeout(() => {
      checkPurchasePrice(materialId, pricePerBase)
        .then((result) => alive && setPriceCheck({ key: priceKey, result }))
        .catch(() => alive && setPriceCheck({ key: priceKey, result: 'ok' }))
    }, PRICE_CHECK_DELAY_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [priceKey, materialId, pricePerBase])
  const priceVerdict: PriceCheck | null = priceCheck && priceCheck.key === priceKey ? priceCheck.result : null

  const chooseObject = (id: string) => {
    haptic.tap()
    setObjectId(id)
    setPickingObject(false)
    setFieldErrors((e) => ({ ...e, object: undefined }))
  }

  const chooseMaterial = (m: Material) => {
    haptic.tap()
    setMaterialId(m.id)
    setUnitId(m.units[0]?.id ?? null)
    setQty('')
    setFieldErrors({})
    setSaveError(null)
    clearPhotoError()
    setSavedText(null)
  }

  const onSumChange = (raw: string, caret: number | null) => {
    const next = formatSumInput(raw)
    caretRef.current = caretAfterFormat(raw, caret ?? raw.length, next)
    setSum(next)
    setFieldErrors((er) => ({ ...er, sum: undefined }))
  }

  const resetEntry = () => {
    setMaterialId(null)
    setUnitId(null)
    setQty('')
    setSum('')
    setNote('')
    setSupplier({ kind: 'none' })
    photo.reset()
    setFieldErrors({})
    setDraftId(uuid())
    setSupplierDraftId(uuid())
  }

  /** Sotuvchi id'si: mavjud, nomi mos keladigan mavjud yoki yangi yaratilgan (idempotent). */
  const resolveSupplier = useCallback(async (): Promise<string | null> => {
    if (supplier.kind === 'none' || !companyId) return null
    if (supplier.kind === 'existing') return supplier.id
    const key = supplierKey(supplier.name)
    const same = suppliers.find((s) => supplierKey(s.name) === key)
    if (same) return same.id
    const created = await createSupplier({ id: supplierDraftId, companyId, name: supplier.name })
    setSuppliers((list) => (list.some((s) => s.id === created.id) ? list : [...list, created]))
    // Keyingi yangi sotuvchi uchun yangi id (qayta urinishda nom bo'yicha shu topiladi)
    setSupplierDraftId(uuid())
    return created.id
  }, [supplier, suppliers, companyId, supplierDraftId])

  const save = useCallback(
    async (opts: { withoutPhoto?: boolean } = {}) => {
      // Sinxron qulf: MainButton va oddiy tugma tez-tez bosilsa ham bitta so'rov
      if (savingRef.current || !profile || preparingPhoto) return
      const draft = { type: 'kirim' as const, objectId, materialId, unitId, qtyInput: qty }
      const result = validateMovementDraft(draft)
      const errors: FieldErrors = {}
      if (!result.ok) {
        if (result.errors.object) errors.object = true
        if (result.errors.unit) errors.unit = true
        if (result.errors.qty) errors.qty = result.errors.qty as QtyErrorKey
      }
      const total = parseSumInput(sum)
      if (sum.trim() === '') errors.sum = 'sumRequired'
      else if (total === null || cmp(total, '0') <= 0) errors.sum = 'sumInvalid'
      if (supplier.kind === 'new' && supplier.name.trim() === '') errors.supplier = true
      if (!result.ok || Object.keys(errors).length > 0 || !objectId || !materialId || !unitId || total === null) {
        setFieldErrors(errors)
        haptic.error()
        return
      }
      savingRef.current = true
      setSaving(true)
      setSaveError(null)
      try {
        const supplierId = await resolveSupplier()
        const receiptPhotoPath = await photo.resolvePath(profile.company_id, opts.withoutPhoto)
        const row = await createPurchase({
          id: draftId,
          companyId: profile.company_id,
          objectId,
          materialId,
          unitId,
          qtyInput: result.qtyInput,
          totalAmount: total,
          supplierId,
          receiptPhotoPath,
          note,
          buyerId: profile.id,
        })
        haptic.success()
        saveLastObject(objectId)
        if (supplierId) rememberSupplier(supplierId)
        setSavedText(
          tp.saved(
            formatQty(row.qty_input),
            unitLabel({ unit: row.unit_input, variant: row.unit_variant }),
            row.material_name ?? material?.name ?? '',
            formatSum(row.total_amount),
          ),
        )
        setBalanceKey((k) => k + 1)
        resetEntry()
      } catch (err) {
        haptic.error()
        // Rasm muammosi saqlashni to'xtatmasin: "Qayta urinish" yoki "Rasmsiz saqlash"
        if (!photo.handleSaveError(err)) setSaveError(errorText(err))
        // Shu nomli sotuvchi bor — ro'yxat yangilanadi, foydalanuvchi mavjudini tanlaydi
        if (errorCodeOf(err) === 'supplier_duplicate') {
          listSuppliers()
            .then(setSuppliers)
            .catch(() => undefined)
        }
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    // resetEntry — faqat setState va photo.reset (photo deps ichida)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, preparingPhoto, objectId, materialId, unitId, qty, sum, supplier, resolveSupplier, photo, draftId, note, material],
  )

  const onMainButton = useCallback(() => {
    void save()
  }, [save])
  const saveWithoutPhoto = () => {
    void save({ withoutPhoto: true })
  }

  const onBack = useCallback(() => {
    if (step === 'details') {
      setMaterialId(null)
      setFieldErrors({})
      setSaveError(null)
      clearPhotoError()
    } else if (step === 'object') {
      setPickingObject(false)
    } else if (step === 'material') {
      setPickingObject(true)
    }
  }, [step, clearPhotoError])
  const canGoBack = step === 'details' || (step === 'object' && Boolean(objectId)) || (step === 'material' && manyObjects)

  useBackButton(canGoBack ? onBack : null)
  useMainButton(tp.save, step === 'details' ? onMainButton : null, preparingPhoto, saving)
  const insideTelegram = getWebApp() !== null

  if (!profile) return null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={tp.title} />
      <BalanceCard balance={balance} />

      {savedText && <SavedBanner>{savedText}</SavedBanner>}

      {loadError && <LoadError message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!loadError && (!objects || !materials) && <SkeletonRows rows={3} />}
      {objects && objects.length === 0 && <Notice tone="warn">{tm.noObjects}</Notice>}

      {objects && objects.length > 0 && materials && (
        <>
          {step === 'object' ? (
            <ObjectChooser objects={objects} selectedId={objectId} lastUsed={loadLastObject()} onPick={chooseObject} />
          ) : (
            object && <ObjectBar object={object} onChange={manyObjects ? () => setPickingObject(true) : null} />
          )}

          {step === 'material' && <MaterialGrid materials={ranked} onPick={chooseMaterial} />}

          {step === 'details' && material && (
            <PurchaseDetails
              material={material}
              unitId={unitId}
              unit={unit}
              qty={qty}
              sum={sum}
              sumRef={sumRef}
              errors={fieldErrors}
              qtyBase={qtyBase}
              perBaseText={pricePerBase !== null ? tp.perBase(material.base_unit, formatSum(round(pricePerBase, 2))) : null}
              priceVerdict={priceVerdict}
              suppliers={orderedSuppliers}
              supplier={supplier}
              note={note}
              photo={{ photo: photo.photo, notice: photo.notice, error: photo.error, preparing: preparingPhoto }}
              saving={saving}
              saveError={saveError}
              showSaveButton={!insideTelegram}
              onQty={(v) => {
                setQty(v)
                setFieldErrors((er) => ({ ...er, qty: undefined }))
              }}
              onUnit={(id) => {
                haptic.select()
                setUnitId(id)
                setFieldErrors((er) => ({ ...er, unit: undefined }))
              }}
              onSum={onSumChange}
              onSupplier={(next) => {
                haptic.select()
                // Nom o'zgarsa — boshqa sotuvchi: yangi qoralama id
                if (next.kind === 'new' && (supplier.kind !== 'new' || supplier.name !== next.name)) {
                  setSupplierDraftId(uuid())
                }
                setSupplier(next)
                setFieldErrors((er) => ({ ...er, supplier: undefined }))
              }}
              onNote={setNote}
              onChangeMaterial={() => setMaterialId(null)}
              onPickPhoto={(f) => void photo.pick(f)}
              onRemovePhoto={photo.remove}
              onSave={onMainButton}
              onSaveWithoutPhoto={saveWithoutPhoto}
            />
          )}
        </>
      )}
    </div>
  )
}
