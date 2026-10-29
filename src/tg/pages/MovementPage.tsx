import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/authContext'
import { Badge, Notice, RetryNotice, SkeletonRows } from '@/components/ui'
import { colors } from '@/components/ui/tokens'
import { errorCodeOf } from '@/data/errors'
import { isBaseUnit, listMaterials } from '@/data/materialsRepo'
import { requestPhotoHash } from '@/data/functions'
import { createMovement, listMyMovements } from '@/data/movementsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listMyOpenPurchases, listOpenPurchases } from '@/data/openPurchasesRepo'
import { getStock } from '@/data/stockRepo'
import type { Material, Movement, MyOpenPurchase, ObjectRow, OpenPurchase } from '@/data/types'
import { cmp, isNegative } from '@/domain/decimal'
import { getMyMaterialUsage } from '@/data/usageRepo'
import {
  defaultObjectId,
  movementWarnings,
  rankMaterials,
  stockAfter,
  validateMovementDraft,
  type DraftErrorCode,
  type DraftField,
  type EntryType,
  type UsageStat,
} from '@/domain/movements'
import { findDuplicateEntry, photoRequired } from '@/domain/rules'
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { entryDateFor } from '@/domain/entryDate'
import { DateChip } from '../entry/DateChips'
import { TODAY_CHOICE, type DateChipsValue } from '../entry/dateChoice'
import { MaterialGrid } from '../entry/MaterialGrid'
import { initialUnitId, loadLastEntry, rememberLastEntry } from '../entry/lastEntry'
import { ObjectLocationButton } from '../entry/ObjectLocationButton'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { useCompanySettings } from '../entry/useCompanySettings'
import { useGeoCapture } from '../entry/useGeoCapture'
import { usePhotoDraft } from '../entry/usePhotoDraft'
import { draftFingerprint, useDraftId } from '../entry/useDraftId'
import { useDiscardGuard } from '../entry/useDiscardGuard'
import { scrollToPhotoField } from '../entry/scrollToField'
import { IncomingTransfers } from '../movement/IncomingTransfers'
import { EntryTypeSwitch } from '../movement/EntryTypeSwitch'
import { MovementDetails } from '../movement/MovementDetails'
import { PendingReceipts } from '../movement/PendingReceipts'
import { loadEntryType, loadLastObject, saveEntryType, saveLastObject } from '../movement/prefs'
import { readMovementPrefill } from '../movement/prefill'
import { readUuidParam } from '../deepLinks'
import { getWebApp, haptic } from '../telegram'
import { SavedBanner } from '../ui'
import { pinnedMaterialIds } from '../entry/useRankedMaterials'
import { flashMainButtonSaved, useBackButton, useClosingConfirmation, useMainButton } from '../useTelegramButtons'

const tm = t.tg.movement
const ta = t.tg.auto
const RECENT_LIMIT = 30
const USAGE_DAYS = 30

type Step = 'object' | 'material' | 'details'
type FieldErrors = Partial<Record<DraftField, DraftErrorCode>>

/** Asosiy birlik (koeffitsient 1) — "qolgan miqdor" asosiy birlikda keladi. */
function baseUnitOf(m: Material) {
  return m.units.find((u) => isBaseUnit(m, u) && cmp(u.factor, '1') === 0) ?? null
}

/** Asosiy birlikdagi miqdor → kiritish maydoni matni ("1 500,5" → "1500,5"). */
function qtyText(qtyBase: string): string {
  return formatQty(qtyBase).replace(/\s/g, '')
}

export function MovementPage() {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  // "Qoldiq" qatoridan kelgan bo'lsa — obyekt, material va tur (chiqim) oldindan tanlanadi
  const location = useLocation()
  const [prefill] = useState(() => readMovementPrefill(location.state))
  // Telegram xabaridagi havola: ?transfer=<id> — kelgan o'tkazmani qabul qilish varag'i
  const [params, setParams] = useSearchParams()
  const linkedTransfer = readUuidParam(params, 'transfer')
  const clearLinkedTransfer = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('transfer')
        return next
      },
      { replace: true },
    )
  }, [setParams])
  const [type, setType] = useState<EntryType>(() => prefill?.type ?? loadEntryType())
  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [objectId, setObjectId] = useState<string | null>(null)
  const [pickingObject, setPickingObject] = useState(false)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  // Yozuv sanasi: standart "Bugun" (server now()) — qo'shimcha bosish yo'q
  const [entryDate, setEntryDate] = useState<DateChipsValue>(TODAY_CHOICE)
  const [dateError, setDateError] = useState<string | null>(null)
  // Ixtiyoriy rasm: yuklangan yo'l eslab qolinadi — qayta urinishda qayta yuklanmaydi
  const photo = usePhotoDraft()
  const preparingPhoto = photo.preparing
  const clearPhotoError = photo.clearError
  const [stock, setStock] = useState<{ key: string; value: string | null } | null>(null)
  // Qoralama id'si — qayta urinishda ikki marta yozilmasin (baza 23505 → saqlangan qator o'qiladi);
  // xatodan keyin asosiy maydonlar o'zgarsa — yangi id
  const draftIds = useDraftId()
  // Chiqimdan keyin qoldiq manfiy — ikkinchi bosish bilan tasdiq ("Baribir chiqim")
  const [negativeAsk, setNegativeAsk] = useState(false)
  const [negativeOk, setNegativeOk] = useState(false)
  // "Qabul kutilmoqda": obyektlarimdagi to'liq qabul qilinmagan xaridlar (bo'lmasa — ko'rsatilmaydi)
  const [myOpen, setMyOpen] = useState<MyOpenPurchase[]>([])
  const [myOpenKey, setMyOpenKey] = useState(0)

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<{ text: string; meta: string } | null>(null)
  // Kelayotgan o'tkazmalar ro'yxati ochiq — forma yashiriladi
  const [incomingOpen, setIncomingOpen] = useState(false)
  // Batch 12 (C): o'zimning oxirgi yozuvlarim — takroriy yozuvni saqlashdan oldin aniqlash uchun
  const [recent, setRecent] = useState<Movement[]>([])
  const [duplicate, setDuplicate] = useState(false)
  const settings = useCompanySettings(companyId)
  const profileId = profile?.id

  useEffect(() => {
    if (!profileId) return
    let alive = true
    Promise.resolve()
      .then(() => listMyOpenPurchases())
      .then((rows) => {
        if (alive && Array.isArray(rows)) setMyOpen(rows)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [profileId, myOpenKey])

  useEffect(() => {
    if (!profileId) return
    let alive = true
    Promise.resolve()
      .then(() => listMyMovements(profileId, RECENT_LIMIT))
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
        const usable = mats.filter((m) => m.is_active && m.company_id === companyId)
        setMaterials(usable)
        const pre = prefill && active.some((o) => o.id === prefill.objectId) ? prefill : null
        setObjectId((cur) => cur ?? pre?.objectId ?? defaultObjectId(active.map((o) => o.id), loadLastObject()))
        const preMaterial = pre ? usable.find((m) => m.id === pre.materialId) : undefined
        if (pre && preMaterial) {
          // Xariddan kelgan kirim: qolgan miqdor asosiy birlikda (xarid — `linkChoice` boshlang'ich qiymatida)
          const base = pre.qtyBase ? baseUnitOf(preMaterial) : null
          setMaterialId((cur) => cur ?? preMaterial.id)
          setUnitId(
            (cur) => cur ?? base?.id ?? initialUnitId(preMaterial.units, profileId ? loadLastEntry(profileId, preMaterial.id) : null),
          )
          const preQty = base && pre.qtyBase ? qtyText(pre.qtyBase) : ''
          if (preQty) setQty((cur) => cur || preQty)
        }
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(errorText(err))
      })
    // Tartib uchun statistika — bo'lmasa ham ekran ishlaydi
    getMyMaterialUsage(USAGE_DAYS)
      .then((rows) => {
        if (alive) setUsage(rows)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // prefill — faqat birinchi ochilishda (useState), profileId — barqaror
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, reloadKey])

  const ranked = useMemo(
    () => (materials ? rankMaterials(materials, usage, new Date().toISOString()) : []),
    [materials, usage],
  )
  // Ko'p ishlatiladiganlar — material to'rining tepasida ajratib ko'rsatiladi
  const pinned = useMemo(() => pinnedMaterialIds(ranked, usage), [ranked, usage])

  const material = materials?.find((m) => m.id === materialId) ?? null
  const unit = material?.units.find((u) => u.id === unitId) ?? null
  const object = objects?.find((o) => o.id === objectId) ?? null
  const manyObjects = (objects?.length ?? 0) > 1

  const step: Step = (!objectId || pickingObject) && manyObjects ? 'object' : !material ? 'material' : 'details'
  // Batch 12 (D): joylashuv ekran ochilishi bilan so'raladi, forma ochilganda eskirgan bo'lsa yangilanadi;
  // saqlash kutmaydi (eng ko'pi 3 s)
  const geo = useGeoCapture(step === 'details' && !incomingOpen)
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  // Joriy qoldiq (chiqimda "Qoldiq: X → Y" va ogohlantirish uchun). Xato bo'lsa — ko'rsatilmaydi.
  const stockKey = objectId && materialId ? `${objectId}:${materialId}` : null
  useEffect(() => {
    if (!objectId || !materialId) return
    let alive = true
    const key = `${objectId}:${materialId}`
    getStock(objectId, materialId)
      .then((value) => {
        if (alive) setStock({ key, value })
      })
      .catch(() => {
        // Xato — neytral "Qoldiqni tekshirib bo'lmadi" (ogohlantirish va tasdiq so'ralmaydi)
        if (alive) setStock({ key, value: null })
      })
    return () => {
      alive = false
    }
  }, [objectId, materialId])
  const stockLoaded = stock !== null && stock.key === stockKey
  const currentStock = stockLoaded ? stock.value : null
  const stockFailed = stockLoaded && stock.value === null

  // Bog'langan xarid (faqat kirim): shu obyekt va materialdagi ochiq xaridlar.
  // Taklif qilinadi, lekin bog'lash faqat foydalanuvchi tanlovi bilan (kalit bo'yicha eslab qolinadi).
  const linkKey = type === 'kirim' && objectId && materialId ? `${objectId}:${materialId}` : null
  const [openPurchases, setOpenPurchases] = useState<{ key: string; rows: OpenPurchase[] } | null>(null)
  const [linkChoice, setLinkChoice] = useState<{ key: string; id: string | null } | null>(() =>
    prefill?.type === 'kirim' && prefill.purchaseId
      ? { key: `${prefill.objectId}:${prefill.materialId}`, id: prefill.purchaseId }
      : null,
  )
  useEffect(() => {
    if (!linkKey || !objectId || !materialId) return
    let alive = true
    listOpenPurchases(objectId, materialId)
      .then((rows) => {
        if (alive) setOpenPurchases({ key: linkKey, rows })
      })
      .catch(() => {
        // Bog'lash ixtiyoriy — xato bo'lsa bo'lim ko'rsatilmaydi
        if (alive) setOpenPurchases({ key: linkKey, rows: [] })
      })
    return () => {
      alive = false
    }
  }, [linkKey, objectId, materialId])
  // Eng eskisi birinchi (Batch 12, A)
  const openRows = useMemo(
    () =>
      openPurchases && openPurchases.key === linkKey
        ? [...openPurchases.rows].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at))
        : [],
    [openPurchases, linkKey],
  )
  // Batch 12 (A): bittagina ochiq xarid — oldindan tanlangan ("Bog'lamaslik" bilan bir bosishda
  // olib tashlanadi); bir nechta — foydalanuvchi tanlaydi. Oldindan berilgan xarid ("Qabul kutilmoqda",
  // xariddan keyin) — faqat ochiq xaridlar ro'yxatida bo'lsa
  const chosen =
    linkChoice !== null && linkChoice.key === linkKey && (linkChoice.id === null || openRows.some((r) => r.id === linkChoice.id))
      ? linkChoice
      : null
  const autoLinked = chosen === null && openRows.length === 1
  const linkedPurchaseId = chosen ? chosen.id : autoLinked ? (openRows[0]?.id ?? null) : null
  const selectLinked = (id: string | null) => {
    if (!linkKey) return
    haptic.select()
    setLinkChoice({ key: linkKey, id })
  }

  // Batch 12 (E): kirimda material "rasm majburiy" bo'lsa
  const photoRule =
    type === 'kirim' && material
      ? photoRequired({
          totalAmount: null,
          thresholdAmount: null,
          materialPhotoRequired: Boolean(material.photo_required),
          qrVerified: false,
        })
      : null
  const photoRequiredReason = photoRule ? ta.photoRequiredMaterial : null
  const photoMissing = photoRequiredReason !== null && !photo.photo
  const lastEntry = profileId && materialId ? loadLastEntry(profileId, materialId) : null

  const parsedQty = validateQtyInput(qty)
  const qtyBase = parsedQty.ok && unit ? toBaseQty(parsedQty.value, unit.factor) : null
  const warnings =
    type === 'chiqim' && qtyBase !== null && currentStock !== null
      ? movementWarnings({ type, qtyBase, currentStock })
      : []
  // Chiqimdan keyingi qoldiq manfiy bo'ladimi (qoldiq ma'lum bo'lsa) — saqlashdan oldin tasdiq
  const afterChiqim = type === 'chiqim' && qtyBase !== null && currentStock !== null ? stockAfter(currentStock, 'chiqim', qtyBase) : null
  const wouldGoNegative = afterChiqim !== null && isNegative(afterChiqim)

  // Obyektdagi ochiq (qabul qilinmagan) xaridlar: banner, material plitkasidagi belgi, chiqimdagi izoh
  const openHere = useMemo(() => myOpen.filter((r) => r.object_id === objectId), [myOpen, objectId])
  const pendingFlags = useMemo(() => {
    const flags = new Map<string, ReactNode>()
    for (const r of openHere) {
      if (flags.has(r.material_id)) continue
      flags.set(
        r.material_id,
        <Badge tone="warn" className="self-start">
          {t.tg.pending.tileFlag}
        </Badge>,
      )
    }
    return flags
  }, [openHere])
  const pendingForMaterial = materialId !== null && openHere.some((r) => r.material_id === materialId)

  const clearNegative = () => {
    setNegativeAsk(false)
    setNegativeOk(false)
  }

  const chooseType = (next: EntryType) => {
    haptic.select()
    setType(next)
    saveEntryType(next)
    clearNegative()
  }

  /** "Qabul kutilmoqda" qatori: kirim — obyekt, material, qolgan miqdor (asosiy birlikda), xarid bog'lanadi. */
  const applyPending = (r: MyOpenPurchase) => {
    const m = materials?.find((x) => x.id === r.material_id)
    if (!m || !objects?.some((o) => o.id === r.object_id)) return
    haptic.tap()
    const base = baseUnitOf(m)
    setType('kirim')
    saveEntryType('kirim')
    setObjectId(r.object_id)
    setPickingObject(false)
    setMaterialId(m.id)
    setUnitId(base?.id ?? initialUnitId(m.units, profileId ? loadLastEntry(profileId, m.id) : null))
    setQty(base ? qtyText(r.remaining_qty_base) : '')
    setLinkChoice({ key: `${r.object_id}:${m.id}`, id: r.purchase_id })
    setStock(null)
    setDuplicate(false)
    clearNegative()
    setFieldErrors({})
    setSaveError(null)
    photo.clearError()
    setSavedText(null)
  }

  const chooseObject = (id: string) => {
    haptic.tap()
    setObjectId(id)
    setPickingObject(false)
    setStock(null)
    setFieldErrors((e) => ({ ...e, object: undefined }))
  }

  const chooseMaterial = (m: Material) => {
    haptic.tap()
    setMaterialId(m.id)
    setUnitId(initialUnitId(m.units, profileId ? loadLastEntry(profileId, m.id) : null))
    setQty('')
    setStock(null)
    setDuplicate(false)
    clearNegative()
    setFieldErrors({})
    setSaveError(null)
    photo.clearError()
    setSavedText(null)
  }

  const resetEntry = () => {
    setMaterialId(null)
    setUnitId(null)
    setQty('')
    setNote('')
    photo.reset()
    setStock(null)
    setLinkChoice(null)
    setDuplicate(false)
    clearNegative()
    setFieldErrors({})
    draftIds.renew()
    setEntryDate(TODAY_CHOICE)
    setDateError(null)
    geo.reset()
  }

  const save = useCallback(
    async (opts: { withoutPhoto?: boolean; confirmDuplicate?: boolean; confirmNegative?: boolean } = {}) => {
      // Sinxron qulf: MainButton va oddiy tugma tez-tez bosilsa ham bitta so'rov
      if (savingRef.current || !profile || preparingPhoto) return
      const nowIso = new Date().toISOString()
      const occurredAt = entryDateFor(entryDate.choice, entryDate.other, nowIso, isAdmin)
      const draft = { type, objectId, materialId, unitId, qtyInput: qty, occurredAt: occurredAt ?? null }
      const result = validateMovementDraft(draft, { nowIso, isAdmin })
      if (occurredAt === undefined) {
        setDateError(entryDate.choice === 'other' && !entryDate.other ? t.tg.date.errRequired : tm.errors.occurredAt)
      }
      if (!result.ok || occurredAt === undefined || !objectId || !materialId || !unitId) {
        setFieldErrors(result.ok ? {} : result.errors)
        if (!result.ok && result.errors.occurredAt) setDateError(tm.errors.occurredAt)
        haptic.error()
        return
      }
      if (photoMissing) {
        // Tugma faol qoladi: bosilsa — rasm maydoniga aylantiriladi (sabab qizil matnda)
        haptic.error()
        scrollToPhotoField()
        return
      }
      // Chiqimdan keyin qoldiq manfiy — ikkinchi bosish ("Baribir chiqim") bilan
      if (wouldGoNegative && !opts.confirmNegative && !negativeOk) {
        setNegativeAsk(true)
        haptic.error()
        return
      }
      if (opts.confirmNegative) setNegativeOk(true)
      setNegativeAsk(false)
      // Yuboriladigan id: xatodan keyin asosiy maydonlar o'zgargan bo'lsa — yangi
      const draftId = draftIds.idFor(draftFingerprint([type, objectId, materialId, unitId, result.qtyInput]))
      // Batch 12 (C): takroriy yozuv — ogohlantirish, bloklamaydi ("Baribir saqlash")
      if (!opts.confirmDuplicate && qtyBase !== null) {
        const prev = recent
          .filter((m) => !m.deleted_at && m.created_by)
          .map((m) => ({
            id: m.id,
            createdBy: m.created_by ?? '',
            kind: m.type,
            objectId: m.object_id,
            materialId: m.material_id,
            qtyBase: m.qty_base,
            createdAt: m.created_at,
          }))
        const dup = findDuplicateEntry(
          prev,
          { id: draftId, createdBy: profile.id, kind: type, objectId, materialId, qtyBase, createdAt: nowIso },
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
      const purchaseId = type === 'kirim' ? linkedPurchaseId : null
      try {
        const [photoPath, geoFix] = await Promise.all([photo.resolvePath(profile.company_id, opts.withoutPhoto), geo.get()])
        const row = await createMovement({
          id: draftId,
          companyId: profile.company_id,
          type,
          objectId,
          materialId,
          unitId,
          qtyInput: result.qtyInput,
          note,
          photoPath,
          geo: geoFix,
          // "Bugun" — sana yuborilmaydi (server now())
          ...(occurredAt ? { occurredAt } : {}),
          ...(purchaseId ? { purchaseId } : {}),
        })
        // Rasm xeshi — serverda, fonda (xato foydalanuvchiga ta'sir qilmaydi)
        if (photoPath) void requestPhotoHash('movements', row.id)
        haptic.success()
        flashMainButtonSaved()
        saveLastObject(objectId)
        rememberLastEntry(profile.id, materialId, unitId, result.qtyInput)
        setRecent((list) => [row, ...list.filter((m) => m.id !== row.id)].slice(0, RECENT_LIMIT))
        // Kirim xaridni qabul qilgan bo'lishi mumkin — "Qabul kutilmoqda" yangilanadi
        if (row.type === 'kirim') setMyOpenKey((k) => k + 1)
        setSavedText({
          text: tm.saved(
            t.movements.types[row.type === 'chiqim' ? 'chiqim' : 'kirim'],
            formatQty(row.qty_input),
            unitLabel({ unit: row.unit_input, variant: row.unit_variant }),
            row.material_name ?? material?.name ?? '',
          ),
          meta: row.object_name ?? object?.name ?? '',
        })
        resetEntry()
      } catch (err) {
        haptic.error()
        // Shu id bilan avval boshqa yozuv saqlangan — keyingi urinish yangi id bilan
        if (errorCodeOf(err) === 'draft_conflict') draftIds.renew()
        // Rasm muammosi saqlashni to'xtatmasin: "Qayta urinish" yoki "Rasmsiz saqlash"
        if (!photo.handleSaveError(err)) setSaveError(errorText(err))
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    // resetEntry — faqat setState va photo.reset (photo deps ichida)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, preparingPhoto, type, objectId, materialId, unitId, qty, photo, linkedPurchaseId, draftIds, note, material, object, isAdmin, photoMissing, qtyBase, recent, settings.duplicateWindowMinutes, geo, entryDate, wouldGoNegative, negativeOk],
  )

  const onMainButton = useCallback(() => {
    void save()
  }, [save])
  const saveDuplicate = useCallback(() => {
    void save({ confirmDuplicate: true })
  }, [save])
  const saveNegative = useCallback(() => {
    void save({ confirmNegative: true })
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

  useBackButton(canGoBack && !incomingOpen ? onBack : null)
  useMainButton(
    negativeAsk ? tm.negativeConfirm : duplicate ? ta.duplicateSave : type === 'kirim' ? tm.saveKirim : tm.saveChiqim,
    step === 'details' && !incomingOpen ? (negativeAsk ? saveNegative : duplicate ? saveDuplicate : onMainButton) : null,
    // Rasm majburiy, lekin tanlanmagan — tugma faol: bosilsa rasm maydoniga aylantiriladi (save)
    preparingPhoto,
    saving,
    // Tur rangi: kirim — yashil, chiqim — ko'k (almashtirgich bilan bir xil)
    negativeAsk ? colors.danger : type === 'kirim' ? colors.ok : colors.brand,
  )
  // Qoralamada ma'lumot bor — Telegram yopishdan oldin so'raydi
  useClosingConfirmation(Boolean(materialId) || qty.trim() !== '' || note.trim() !== '')
  // Pastki menyu orqali chiqib ketishdan oldin — tasdiq (kiritilgan miqdor, izoh yoki rasm yo'qolmasin)
  const discard = useDiscardGuard(qty.trim() !== '' || note.trim() !== '' || photo.photo !== null)
  const insideTelegram = getWebApp() !== null

  if (!profile) return null

  return (
    <div className="flex flex-col gap-4">
      {objects && objects.length > 0 && (
        <IncomingTransfers
          objectIds={objects.map((o) => o.id)}
          open={incomingOpen}
          onOpenChange={setIncomingOpen}
          linkedId={linkedTransfer}
          onLinkedHandled={clearLinkedTransfer}
        />
      )}
      {!incomingOpen && (
        <>
          <EntryTypeSwitch value={type} onChange={chooseType} />

          {savedText && <SavedBanner meta={savedText.meta}>{savedText.text}</SavedBanner>}

          {type === 'kirim' && step !== 'details' && objects && materials && (
            <PendingReceipts rows={manyObjects ? myOpen : openHere} showObject={manyObjects} onPick={applyPending} />
          )}

          {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
          {!loadError && (!objects || !materials) && <SkeletonRows rows={3} />}
          {objects && objects.length === 0 && <Notice tone="warn">{tm.noObjects}</Notice>}

          {objects && objects.length > 0 && materials && (
            <>
              {step === 'object' ? (
                <ObjectChooser objects={objects} selectedId={objectId} lastUsed={loadLastObject()} onPick={chooseObject} />
              ) : (
                object && (
                  <div className="flex flex-col gap-1">
                    <ObjectBar
                      object={object}
                      onChange={manyObjects ? () => setPickingObject(true) : null}
                      // Sana — ixcham chip shu satrda: klaviatura ochilganda ham ko'rinadi, standart "Bugun"
                      extra={
                        <DateChip
                          value={entryDate}
                          isAdmin={isAdmin}
                          error={dateError}
                          onChange={(next) => {
                            setEntryDate(next)
                            setDateError(null)
                          }}
                        />
                      }
                    />
                    {dateError && (
                      <p role="alert" className="text-sm text-danger">
                        {dateError}
                      </p>
                    )}
                  </div>
                )
              )}

              {step === 'material' && (
                <MaterialGrid
                  materials={ranked}
                  pinnedIds={pinned}
                  flags={type === 'kirim' ? pendingFlags : undefined}
                  onPick={chooseMaterial}
                />
              )}

              {step === 'details' && material && (
                <MovementDetails
                  type={type}
                  material={material}
                  unitId={unitId}
                  unit={unit}
                  qty={qty}
                  qtyError={fieldErrors.qty}
                  unitError={Boolean(fieldErrors.unit)}
                  objectError={Boolean(fieldErrors.object)}
                  qtyBase={qtyBase}
                  stock={
                    type === 'chiqim' && currentStock !== null && qtyBase !== null
                      ? { current: currentStock, after: stockAfter(currentStock, 'chiqim', qtyBase) }
                      : null
                  }
                  stockNow={type === 'chiqim' ? { current: currentStock, failed: stockFailed } : null}
                  stockEmpty={
                    type === 'chiqim' && currentStock !== null && cmp(currentStock, '0') <= 0 ? { pending: pendingForMaterial } : null
                  }
                  onToKirim={() => chooseType('kirim')}
                  negativeAfter={negativeAsk && afterChiqim !== null ? afterChiqim : null}
                  onConfirmNegative={saveNegative}
                  onCancelNegative={() => {
                    setNegativeAsk(false)
                    document.getElementById('movement-qty')?.focus()
                  }}
                  warning={warnings[0] ?? null}
                  openPurchases={openRows}
                  linkedPurchaseId={linkedPurchaseId}
                  autoLinked={autoLinked}
                  lastEntry={lastEntry}
                  onUseLast={(v, uid) => {
                    haptic.select()
                    setQty(v)
                    setUnitId(uid)
                    setDuplicate(false)
                    // Miqdor almashdi — oldingi miqdor uchun berilgan manfiy qoldiq tasdig'i amal qilmaydi
                    clearNegative()
                    setFieldErrors((er) => ({ ...er, qty: undefined, unit: undefined }))
                  }}
                  photoRequiredReason={photoRequiredReason}
                  duplicateMinutes={duplicate ? settings.duplicateWindowMinutes : null}
                  onConfirmDuplicate={saveDuplicate}
                  onCancelDuplicate={() => setDuplicate(false)}
                  extra={
                    isAdmin && object ? (
                      <ObjectLocationButton
                        object={object}
                        onSaved={(o) => setObjects((list) => list?.map((x) => (x.id === o.id ? o : x)) ?? list)}
                      />
                    ) : null
                  }
                  note={note}
                  photo={{ photo: photo.photo, notice: photo.notice, error: photo.error, preparing: preparingPhoto }}
                  saving={saving}
                  saveError={saveError}
                  showSaveButton={!insideTelegram}
                  onQty={(v) => {
                    setQty(v)
                    setDuplicate(false)
                    clearNegative()
                    setFieldErrors((er) => ({ ...er, qty: undefined }))
                  }}
                  onUnit={(id) => {
                    haptic.select()
                    setUnitId(id)
                    setDuplicate(false)
                    clearNegative()
                    setFieldErrors((er) => ({ ...er, unit: undefined }))
                  }}
                  onNote={setNote}
                  onChangeMaterial={() => setMaterialId(null)}
                  onSelectLinked={selectLinked}
                  onPickPhoto={(f) => void photo.pick(f)}
                  onRemovePhoto={photo.remove}
                  onSave={onMainButton}
                  onSaveWithoutPhoto={saveWithoutPhoto}
                />
              )}
            </>
          )}
        </>
      )}
      {discard.element}
    </div>
  )
}
