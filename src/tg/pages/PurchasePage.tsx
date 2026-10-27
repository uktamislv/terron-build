import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '@/auth/authContext'
import { Receipt, ShoppingCart } from 'lucide-react'
import { BottomSheet, Notice, RetryNotice, SegmentedControl, SkeletonRows } from '@/components/ui'
import { getMyBalance } from '@/data/cashRepo'
import { errorCodeOf } from '@/data/errors'
import { requestPhotoHash } from '@/data/functions'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { checkPurchasePrice, createPurchase, listMyPurchases, type PriceCheck, type PurchaseReceiptQr } from '@/data/purchasesRepo'
import { receiptLookup, type ReceiptLookup } from '@/data/receiptRepo'
import { listApprovedRequests, listApprovedRequestsAll } from '@/data/requestsRepo'
import { createSupplier, findByTin, listSuppliers, supplierKey } from '@/data/suppliersRepo'
import type { Material, MaterialRequest, ObjectRow, Purchase, Supplier } from '@/data/types'
import { getMyMaterialUsage } from '@/data/usageRepo'
import { matchMaterialByName } from '@/domain/aliases'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { cmp, isZero, round } from '@/domain/decimal'
import { defaultObjectId, rankMaterials, validateMovementDraft, type UsageStat } from '@/domain/movements'
import { parseReceiptQr, type ReceiptQr } from '@/domain/receipt'
import { findDuplicateEntry, photoRequired, receiptVerified } from '@/domain/rules'
import { purchasePrices, toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty, formatSum } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { entryDateFor } from '@/domain/entryDate'
import { DateChips } from '../entry/DateChips'
import { readUuidParam } from '../deepLinks'
import { TODAY_CHOICE, type DateChipsValue } from '../entry/dateChoice'
import { MaterialGrid } from '../entry/MaterialGrid'
import { initialUnitId, loadLastEntry, rememberLastEntry } from '../entry/lastEntry'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { useCompanySettings } from '../entry/useCompanySettings'
import { useGeoCapture } from '../entry/useGeoCapture'
import { usePhotoDraft } from '../entry/usePhotoDraft'
import { ApprovedRequestChips, RequestTag } from '../purchase/ApprovedRequests'
import { ReceiptCard, ScanReceiptButton } from '../purchase/ReceiptCard'
import { canScanQr, scanQr } from '../qrScan'
import { loadLastObject, saveLastObject } from '../movement/prefs'
import { loadPurchaseMode, loadRecentSuppliers, rememberSupplier, savePurchaseMode, type PurchaseMode } from '../purchase/prefs'
import { ExpenseEntry } from '../purchase/ExpenseEntry'
import { CashHistory } from '../purchase/CashHistory'
import { BalanceCard, PurchaseDetails, type PurchaseFieldErrors } from '../purchase/PurchaseDetails'
import type { SupplierChoice } from '../purchase/SupplierPicker'
import { getWebApp, haptic } from '../telegram'
import { SavedBanner } from '../ui'
import { pinnedMaterialIds } from '../entry/useRankedMaterials'
import { flashMainButtonSaved, useBackButton, useClosingConfirmation, useMainButton } from '../useTelegramButtons'

const tm = t.tg.movement
const tp = t.tg.purchase
const ta = t.tg.auto
const te = t.expenses
const USAGE_DAYS = 30
const RECENT_LIMIT = 30
/** Chek qatori nomi katalogdagi materialga shu balldan past mos kelsa — foydalanuvchi o'zi tanlaydi. */
const RECEIPT_MATCH_MIN_SCORE = 0.5

/** Chek QR holati (G): QR maydonlari, soliq sahifasidan o'qilgan ma'lumot (bo'lsa), tanlangan qator. */
interface ReceiptState {
  qr: ReceiptQr
  lookup: ReceiptLookup | null
  lineIndex: number | null
}
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

/** Material xaridi (oldingi "Xarid" ekrani). Balans kartasi — `PurchasePage` da (ikkala rejim uchun umumiy). */
function MaterialPurchase({ onBalanceChange }: { onBalanceChange: () => void }) {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  const profileId = profile?.id

  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)


  const [objectId, setObjectId] = useState<string | null>(null)
  const [pickingObject, setPickingObject] = useState(false)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [sum, setSum] = useState('')
  const [note, setNote] = useState('')
  // Xarid sanasi: standart "Bugun" (server now()); chekdagi sana bo'lsa — o'sha
  const [entryDate, setEntryDate] = useState<DateChipsValue>(TODAY_CHOICE)
  const [dateError, setDateError] = useState<string | null>(null)
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
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
  const [savedText, setSavedText] = useState<{ text: string; meta: string } | null>(null)

  const sumRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)

  // Batch 12
  const settings = useCompanySettings(companyId)
  const [recent, setRecent] = useState<Purchase[]>([])
  const [duplicate, setDuplicate] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptState | null>(null)
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null)
  const [receiptUsed, setReceiptUsed] = useState(false)
  const [approved, setApproved] = useState<{ objectId: string; rows: MaterialRequest[] } | null>(null)
  const [request, setRequest] = useState<MaterialRequest | null>(null)
  const scanAvailable = canScanQr()

  useEffect(() => {
    if (!profileId) return
    let alive = true
    Promise.resolve()
      .then(() => listMyPurchases(profileId, RECENT_LIMIT))
      .then((rows) => {
        if (alive && Array.isArray(rows)) setRecent(rows)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [profileId])

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
  // Ko'p ishlatiladiganlar — material to'rining tepasida ajratib ko'rsatiladi
  const pinned = useMemo(() => pinnedMaterialIds(ranked, usage), [ranked, usage])
  const orderedSuppliers = useMemo(() => orderSuppliers(suppliers, loadRecentSuppliers()), [suppliers])

  const material = materials?.find((m) => m.id === materialId) ?? null
  const unit = material?.units.find((u) => u.id === unitId) ?? null
  const object = objects?.find((o) => o.id === objectId) ?? null
  const manyObjects = (objects?.length ?? 0) > 1
  const step: Step = (!objectId || pickingObject) && manyObjects ? 'object' : !material ? 'material' : 'details'
  // Batch 12 (D): xarid do'konda — joylashuv faqat saqlanadi (alert yo'q). Ekran ochilishi bilan so'raladi.
  const geo = useGeoCapture(step === 'details')

  // Ta'minotchi: barcha obyektlardagi tasdiqlangan so'rovlar (obyekt bo'yicha guruhlangan); bittasini
  // tanlash — obyekt ham tanlanadi. Telegram xabaridagi ?request=<id> — shu so'rov oldindan tanlanadi.
  const allObjectsMode = profile?.role === 'taminotchi'
  const [approvedAll, setApprovedAll] = useState<MaterialRequest[] | null>(null)
  const [params, setParams] = useSearchParams()
  const linkedRequest = readUuidParam(params, 'request')
  useEffect(() => {
    if (!allObjectsMode) return
    let alive = true
    Promise.resolve()
      .then(() => listApprovedRequestsAll())
      .then((rows) => {
        if (alive) setApprovedAll(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (alive) setApprovedAll([])
      })
    return () => {
      alive = false
    }
  }, [allObjectsMode])

  // Batch 12 (H): obyektning tasdiqlangan so'rovlari (ko'rinmasa — chiplar yo'q)
  useEffect(() => {
    if (!objectId || allObjectsMode) return
    let alive = true
    Promise.resolve()
      .then(() => listApprovedRequests(objectId))
      .then((rows) => {
        if (alive) setApproved({ objectId, rows: Array.isArray(rows) ? rows : [] })
      })
      .catch(() => {
        if (alive) setApproved({ objectId, rows: [] })
      })
    return () => {
      alive = false
    }
  }, [objectId, allObjectsMode])
  const approvedRows = allObjectsMode ? (approvedAll ?? []) : approved && approved.objectId === objectId ? approved.rows : []

  const lastEntry = profileId && materialId ? loadLastEntry(profileId, materialId) : null
  // Server bilan bir xil (receiptVerified): soliq.uz javobidagi chek jami yoki qator summasi xarid summasidan
  // ≤ 1 so'm farq qiladi va chek sanasi xarid sanasidan ±3 kun ichida. Javob yo'q yoki jami noma'lum — tasdiqlanmagan.
  // Rasm majburiyatidan ozod qilish va "Chek tasdiqlandi" belgisi shu natijaga tayanadi.
  const qrVerified = receipt?.lookup
    ? receiptVerified({
        lookupTotal: receipt.lookup.total,
        lookupItems: receipt.lookup.items,
        lookupReceiptAt: receipt.lookup.datetime ?? receipt.qr.datetime,
        totalAmount: parseSumInput(sum),
        purchasedAt: receipt.lookup.datetime ?? receipt.qr.datetime ?? entryDateFor(entryDate.choice, entryDate.other, new Date().toISOString(), isAdmin) ?? new Date().toISOString(),
      })
    : false

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

  // Batch 12 (E): summa chegarasi yoki material belgisi; QR orqali tasdiqlangan chek — rasmsiz ham
  const photoRule = material
    ? photoRequired({
        totalAmount: sumDec,
        thresholdAmount: settings.photoRequiredAmount,
        materialPhotoRequired: Boolean(material.photo_required),
        qrVerified,
      })
    : null
  const photoRequiredReason =
    photoRule === 'material'
      ? ta.photoRequiredMaterial
      : photoRule === 'amount' && settings.photoRequiredAmount !== null
        ? ta.photoRequiredAmount(formatSum(settings.photoRequiredAmount))
        : null
  const photoMissing = photoRequiredReason !== null && !photo.photo

  /** Chek qatorini formaga qo'yadi: material nom bo'yicha moslanadi, miqdor va summa to'ladi. */
  const applyReceiptLine = (lookup: ReceiptLookup, index: number) => {
    const line = lookup.items[index]
    if (!line) return
    const candidates = (materials ?? []).map((m) => ({ id: m.id, name: m.name, aliases: m.aliases.map((a) => a.alias) }))
    const best = matchMaterialByName(line.name, candidates)[0]
    const matched = best && best.score >= RECEIPT_MATCH_MIN_SCORE ? (materials ?? []).find((m) => m.id === best.id) : undefined
    const lineSum = lookup.items.length > 1 ? line.sum : (lookup.total ?? line.sum)
    setSum(formatSumInput(lineSum.replace('.', ',')))
    if (matched) {
      setMaterialId(matched.id)
      // Chekdagi miqdor — asosiy birlikda deb olinadi (foydalanuvchi tekshiradi)
      setUnitId(matched.units[0]?.id ?? null)
      setQty(line.qty)
      setReceiptNotice(null)
    } else {
      setReceiptNotice(ta.receiptNoMatch(line.name))
    }
    setFieldErrors({})
  }

  const scanReceipt = async () => {
    if (receiptBusy) return
    haptic.tap()
    setReceiptNotice(null)
    setReceiptUsed(false)
    const text = await scanQr(ta.scanText)
    if (text === null) return
    const qr = parseReceiptQr(text)
    if (!qr) {
      haptic.error()
      setReceiptNotice(ta.notReceiptQr)
      return
    }
    setReceiptBusy(true)
    let lookup: ReceiptLookup | null
    let rateLimited = false
    try {
      lookup = await receiptLookup(qr.url)
    } catch (err) {
      if (errorCodeOf(err) === 'receipt_url_invalid') {
        haptic.error()
        setReceiptNotice(ta.notReceiptQr)
        setReceiptBusy(false)
        return
      }
      // Sahifa ochilmadi — QR maydonlari saqlanadi, qolgani qo'lda
      lookup = null
      // Juda ko'p so'rov (receipt-lookup 429) — QR saqlanadi, sabab ko'rsatiladi
      rateLimited = errorCodeOf(err) === 'rate_limited'
    }
    setReceiptBusy(false)
    haptic.success()
    const single = lookup !== null && lookup.items.length <= 1
    setReceipt({ qr, lookup, lineIndex: single && lookup && lookup.items.length === 1 ? 0 : null })
    if (rateLimited) setReceiptNotice(t.errors.rate_limited)
    if (lookup) {
      // Sotuvchi: STIR bo'yicha mavjud, bo'lmasa nom bilan yangi (saqlashda STIR bilan yaratiladi)
      const known = findByTin(suppliers, lookup.sellerTin)
      if (known) setSupplier({ kind: 'existing', id: known.id })
      else if (lookup.sellerName) setSupplier({ kind: 'new', name: lookup.sellerName })
      if (lookup.items.length === 1) applyReceiptLine(lookup, 0)
      else if (lookup.items.length === 0 && lookup.total) setSum(formatSumInput(lookup.total.replace('.', ',')))
    }
  }

  const pickReceiptLine = (index: number) => {
    if (!receipt?.lookup) return
    haptic.select()
    setReceipt({ ...receipt, lineIndex: index })
    applyReceiptLine(receipt.lookup, index)
  }

  const removeReceipt = () => {
    haptic.select()
    setReceipt(null)
    setReceiptNotice(null)
    setReceiptUsed(false)
  }

  /** So'rov chipi: obyekt, material, birlik va miqdor to'ladi; xarid shu so'rovga bog'lanadi. */
  const pickRequest = (r: MaterialRequest) => {
    const m = materials?.find((x) => x.id === r.material_id)
    if (!m) return
    if (!objects?.some((o) => o.id === r.object_id)) return
    haptic.tap()
    setObjectId(r.object_id)
    setPickingObject(false)
    setRequest(r)
    setMaterialId(m.id)
    setUnitId(m.units.some((u) => u.id === r.unit_id) ? r.unit_id : (m.units[0]?.id ?? null))
    setQty(r.qty_input)
    setFieldErrors({})
    setSaveError(null)
    setSavedText(null)
  }

  const chooseObject = (id: string) => {
    haptic.tap()
    // Boshqa obyekt — tanlangan so'rov chipi shu obyektniki emas
    if (id !== objectId) setRequest(null)
    setObjectId(id)
    setPickingObject(false)
    setFieldErrors((e) => ({ ...e, object: undefined }))
  }

  const chooseMaterial = (m: Material) => {
    haptic.tap()
    setMaterialId(m.id)
    setUnitId(initialUnitId(m.units, profileId ? loadLastEntry(profileId, m.id) : null))
    setQty('')
    setDuplicate(false)
    // Boshqa material — so'rov bog'lanmaydi
    if (request && request.material_id !== m.id) setRequest(null)
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
    setDuplicate(false)
  }

  const resetEntry = () => {
    setEntryDate(TODAY_CHOICE)
    setDateError(null)
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
    setReceipt(null)
    setReceiptNotice(null)
    setReceiptUsed(false)
    setRequest(null)
    setDuplicate(false)
    geo.reset()
  }

  /** Sotuvchi id'si: mavjud, nomi mos keladigan mavjud yoki yangi yaratilgan (idempotent). */
  const resolveSupplier = useCallback(async (): Promise<string | null> => {
    if (supplier.kind === 'none' || !companyId) return null
    if (supplier.kind === 'existing') return supplier.id
    const key = supplierKey(supplier.name)
    const same = suppliers.find((s) => supplierKey(s.name) === key)
    if (same) return same.id
    const created = await createSupplier({
      id: supplierDraftId,
      companyId,
      name: supplier.name,
      tin: receipt?.lookup?.sellerTin ?? null,
    })
    setSuppliers((list) => (list.some((s) => s.id === created.id) ? list : [...list, created]))
    // Keyingi yangi sotuvchi uchun yangi id (qayta urinishda nom bo'yicha shu topiladi)
    setSupplierDraftId(uuid())
    return created.id
  }, [supplier, suppliers, companyId, supplierDraftId, receipt])

  const save = useCallback(
    async (opts: { withoutPhoto?: boolean; confirmDuplicate?: boolean } = {}) => {
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
      // Sana: chekdagi sana ustun; aks holda "Bugun / Kecha / Boshqa sana"
      const receiptDate = receipt?.lookup?.datetime ?? receipt?.qr.datetime ?? null
      const chosenDate = receiptDate ? null : entryDateFor(entryDate.choice, entryDate.other, new Date().toISOString(), isAdmin)
      if (chosenDate === undefined) {
        setDateError(entryDate.choice === 'other' && !entryDate.other ? t.tg.date.errRequired : tm.errors.occurredAt)
      }
      const total = parseSumInput(sum)
      if (sum.trim() === '') errors.sum = 'sumRequired'
      else if (total === null || cmp(total, '0') <= 0) errors.sum = 'sumInvalid'
      if (supplier.kind === 'new' && supplier.name.trim() === '') errors.supplier = true
      if (!result.ok || Object.keys(errors).length > 0 || chosenDate === undefined || !objectId || !materialId || !unitId || total === null) {
        setFieldErrors(errors)
        haptic.error()
        return
      }
      if (photoMissing) {
        haptic.error()
        return
      }
      const nowIso = new Date().toISOString()
      // Batch 12 (C): takroriy xarid — ogohlantirish, bloklamaydi
      if (!opts.confirmDuplicate && qtyBase !== null) {
        const prev = recent
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
          }))
        const dup = findDuplicateEntry(
          prev,
          { id: draftId, createdBy: profile.id, kind: 'purchase', objectId, materialId, qtyBase, totalAmount: total, createdAt: nowIso },
          settings.duplicateWindowMinutes,
        )
        if (dup) {
          setDuplicate(true)
          haptic.error()
          return
        }
      }
      setDuplicate(false)
      savingRef.current = true
      setSaving(true)
      setSaveError(null)
      setReceiptUsed(false)
      const receiptQr: PurchaseReceiptQr | null = receipt
        ? {
            fiscalSign: receipt.qr.fiscalSign,
            terminalId: receipt.qr.terminalId,
            receiptNo: receipt.qr.receiptNo,
            verified: receipt.lookup !== null,
            // Ko'p qatorli chekda ham — butun chek jami (server chek_farqi ni bunday chekda chiqarmaydi)
            total: receipt.lookup?.total ?? receipt.qr.total ?? null,
            sellerTin: receipt.lookup?.sellerTin ?? null,
          }
        : null
      const purchasedAt = receiptDate ?? chosenDate ?? null
      try {
        const supplierId = await resolveSupplier()
        const [receiptPhotoPath, geoFix] = await Promise.all([
          photo.resolvePath(profile.company_id, opts.withoutPhoto),
          geo.get(),
        ])
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
          purchasedAt,
          requestId: request && request.material_id === materialId ? request.id : null,
          receipt: receiptQr,
          geo: geoFix,
        })
        // Chek rasmi xeshi — serverda, fonda (xato foydalanuvchiga ta'sir qilmaydi)
        if (receiptPhotoPath) void requestPhotoHash('purchases', row.id)
        haptic.success()
        flashMainButtonSaved()
        saveLastObject(objectId)
        rememberLastEntry(profile.id, materialId, unitId, result.qtyInput)
        setRecent((list) => [row, ...list.filter((p) => p.id !== row.id)].slice(0, RECENT_LIMIT))
        if (request) {
          setApproved((a) => (a ? { ...a, rows: a.rows.filter((r) => r.id !== request.id) } : a))
          setApprovedAll((list) => list?.filter((r) => r.id !== request.id) ?? list)
        }
        if (supplierId) rememberSupplier(supplierId)
        setSavedText({
          text: tp.saved(
            formatQty(row.qty_input),
            unitLabel({ unit: row.unit_input, variant: row.unit_variant }),
            row.material_name ?? material?.name ?? '',
          ),
          meta: formatSum(row.total_amount),
        })
        onBalanceChange()
        resetEntry()
      } catch (err) {
        haptic.error()
        // Rasm muammosi saqlashni to'xtatmasin: "Qayta urinish" yoki "Rasmsiz saqlash"
        if (!photo.handleSaveError(err)) setSaveError(errorText(err))
        // Batch 12 (G): chek boshqa xaridda — chek kartasida "olib tashlash" izohi
        if (errorCodeOf(err) === 'receipt_already_used') setReceiptUsed(true)
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
    [onBalanceChange, profile, preparingPhoto, objectId, materialId, unitId, qty, sum, supplier, resolveSupplier, photo, draftId, note, material, photoMissing, qtyBase, recent, settings.duplicateWindowMinutes, receipt, request, geo, entryDate, isAdmin],
  )

  const onMainButton = useCallback(() => {
    void save()
  }, [save])
  const saveDuplicate = useCallback(() => {
    void save({ confirmDuplicate: true })
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
  useMainButton(
    duplicate ? ta.duplicateSave : tp.save,
    step === 'details' ? (duplicate ? saveDuplicate : onMainButton) : null,
    preparingPhoto || photoMissing,
    saving,
  )
  // Qoralamada ma'lumot bor — Telegram yopishdan oldin so'raydi
  useClosingConfirmation(Boolean(materialId) || qty.trim() !== '' || sum.trim() !== '' || note.trim() !== '')
  const receiptView = receipt
    ? {
        receiptNo: receipt.qr.receiptNo,
        verified: qrVerified,
        total: receipt.lookup?.total ?? null,
        sellerName: receipt.lookup?.sellerName ?? null,
        datetime: receipt.lookup?.datetime ?? receipt.qr.datetime,
        items: receipt.lookup?.items ?? [],
        lineIndex: receipt.lineIndex,
      }
    : null
  const receiptBlock = (
    <>
      {receiptView && (
        <ReceiptCard receipt={receiptView} usedError={receiptUsed} onRemove={removeReceipt} onPickLine={pickReceiptLine} />
      )}
      {!receiptView && scanAvailable && <ScanReceiptButton busy={receiptBusy} onScan={() => void scanReceipt()} />}
      {receiptNotice && <Notice tone="warn">{receiptNotice}</Notice>}
    </>
  )
  const insideTelegram = getWebApp() !== null

  // Havoladagi so'rov ro'yxatda bo'lsa — tanlanadi (topilmasa — jim); parametr bir marta ishlatiladi
  useEffect(() => {
    if (!linkedRequest || !approvedAll || !materials || !objects) return
    const r = approvedAll.find((x) => x.id === linkedRequest)
    // Holat yangilanishi — effekt tanasida emas, navbatdagi mikrotopshiriqda
    if (r) void Promise.resolve().then(() => pickRequest(r))
    const next = new URLSearchParams(params)
    next.delete('request')
    setParams(next, { replace: true })
    // pickRequest — har renderda yangi; faqat ma'lumot yuklanganda bir marta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRequest, approvedAll, materials, objects])

  if (!profile) return null

  return (
    <div className="flex flex-col gap-4">
      {savedText && <SavedBanner meta={savedText.meta}>{savedText.text}</SavedBanner>}

      {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!loadError && (!objects || !materials) && <SkeletonRows rows={3} />}
      {objects && objects.length === 0 && <Notice tone="warn">{tm.noObjects}</Notice>}

      {objects && objects.length > 0 && materials && (
        <>
          {step === 'object' && allObjectsMode && <ApprovedRequestChips requests={approvedRows} onPick={pickRequest} groupByObject />}
          {step === 'object' ? (
            <ObjectChooser objects={objects} selectedId={objectId} lastUsed={loadLastObject()} onPick={chooseObject} />
          ) : (
            object && <ObjectBar object={object} onChange={manyObjects ? () => setPickingObject(true) : null} />
          )}

          {step === 'material' && (
            <>
              {receiptBlock}
              <ApprovedRequestChips requests={approvedRows} onPick={pickRequest} groupByObject={allObjectsMode} />
              <MaterialGrid materials={ranked} pinnedIds={pinned} onPick={chooseMaterial} />
            </>
          )}

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
                setDuplicate(false)
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
              dateField={
                receipt?.lookup?.datetime || receipt?.qr.datetime ? null : (
                  <DateChips
                    value={entryDate}
                    isAdmin={isAdmin}
                    error={dateError}
                    onChange={(next) => {
                      setEntryDate(next)
                      setDateError(null)
                    }}
                  />
                )
              }
              top={
                <>
                  {request && request.material_id === material.id && (
                    <RequestTag
                      request={request}
                      onClear={() => {
                        haptic.select()
                        setRequest(null)
                      }}
                    />
                  )}
                  {receiptBlock}
                </>
              }
              lastEntry={lastEntry}
              onUseLast={(v, uid) => {
                haptic.select()
                setQty(v)
                setUnitId(uid)
                setDuplicate(false)
                setFieldErrors((er) => ({ ...er, qty: undefined, unit: undefined }))
              }}
              photoRequiredReason={photoRequiredReason}
              duplicateMinutes={duplicate ? settings.duplicateWindowMinutes : null}
              onConfirmDuplicate={saveDuplicate}
              onCancelDuplicate={() => setDuplicate(false)}
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

/**
 * "Xarid" ekrani: tepada "Material / Xarajat" almashtirgichi (oxirgi tanlov eslab qolinadi), ostida "Qo'limda"
 * kartasi (ikkala rejimda umumiy) va tanlangan forma. Telegram xabaridagi `?request=` — doim material.
 */
export function PurchasePage() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<PurchaseMode>(() => (readUuidParam(params, 'request') ? 'material' : loadPurchaseMode()))
  const [balance, setBalance] = useState<{ value: string | null; failed: boolean } | null>(null)
  const [balanceKey, setBalanceKey] = useState(0)
  // "Qo'limda" kartasi → pul tarixi (berilgan, qaytarilgan, sarflangan)
  const [cashOpen, setCashOpen] = useState(false)
  const companyId = profile?.company_id
  const profileId = profile?.id

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

  const refreshBalance = useCallback(() => setBalanceKey((k) => k + 1), [])
  if (!profile) return null
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label={te.modeLabel}
        value={mode}
        size="lg"
        onChange={(next) => {
          haptic.select()
          setMode(next)
          savePurchaseMode(next)
        }}
        options={[
          { value: 'material', label: te.modeMaterial, tone: 'navy', icon: <ShoppingCart aria-hidden strokeWidth={1.75} /> },
          { value: 'expense', label: te.modeExpense, tone: 'navy', icon: <Receipt aria-hidden strokeWidth={1.75} /> },
        ]}
      />
      <BalanceCard
        balance={balance}
        onOpen={() => {
          haptic.tap()
          setCashOpen(true)
        }}
      />
      {cashOpen && (
        <BottomSheet title={t.tg.cashHistory.title} onClose={() => setCashOpen(false)}>
          <CashHistory profileId={profile.id} />
        </BottomSheet>
      )}
      {mode === 'material' ? <MaterialPurchase onBalanceChange={refreshBalance} /> : <ExpenseEntry profile={profile} onSaved={refreshBalance} />}
    </div>
  )
}
