import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { Notice, PageHeader, SkeletonRows } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { createMovement, listMyMovements } from '@/data/movementsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listOpenPurchases } from '@/data/openPurchasesRepo'
import { getStock } from '@/data/stockRepo'
import type { Material, Movement, ObjectRow, OpenPurchase } from '@/data/types'
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
import { uuid } from '@/lib/uuid'
import { MaterialGrid } from '../entry/MaterialGrid'
import { initialUnitId, loadLastEntry, rememberLastEntry } from '../entry/lastEntry'
import { ObjectLocationButton } from '../entry/ObjectLocationButton'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { useCompanySettings } from '../entry/useCompanySettings'
import { useGeoCapture } from '../entry/useGeoCapture'
import { usePhotoDraft } from '../entry/usePhotoDraft'
import { IncomingTransfers } from '../movement/IncomingTransfers'
import { EntryTypeSwitch } from '../movement/EntryTypeSwitch'
import { MovementDetails } from '../movement/MovementDetails'
import { loadEntryType, loadLastObject, saveEntryType, saveLastObject } from '../movement/prefs'
import { getWebApp, haptic } from '../telegram'
import { LoadError, SavedBanner } from '../ui'
import { useBackButton, useMainButton } from '../useTelegramButtons'

const tm = t.tg.movement
const ta = t.tg.auto
const RECENT_LIMIT = 30
const USAGE_DAYS = 30

type Step = 'object' | 'material' | 'details'
type FieldErrors = Partial<Record<DraftField, DraftErrorCode>>

export function MovementPage() {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  const [type, setType] = useState<EntryType>(loadEntryType)
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
  // Ixtiyoriy rasm: yuklangan yo'l eslab qolinadi — qayta urinishda qayta yuklanmaydi
  const photo = usePhotoDraft()
  const preparingPhoto = photo.preparing
  const clearPhotoError = photo.clearError
  const [stock, setStock] = useState<{ key: string; value: string } | null>(null)
  // Qoralama id'si — qayta urinishda ikki marta yozilmasin (baza 23505 → saqlangan qator o'qiladi)
  const [draftId, setDraftId] = useState<string>(() => uuid())

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)
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
        setMaterials(mats.filter((m) => m.is_active && m.company_id === companyId))
        setObjectId((cur) => cur ?? defaultObjectId(active.map((o) => o.id), loadLastObject()))
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
  }, [companyId, reloadKey])

  const ranked = useMemo(
    () => (materials ? rankMaterials(materials, usage, new Date().toISOString()) : []),
    [materials, usage],
  )

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
        if (alive) setStock(null)
      })
    return () => {
      alive = false
    }
  }, [objectId, materialId])
  const currentStock = stock && stock.key === stockKey ? stock.value : null

  // Bog'langan xarid (faqat kirim): shu obyekt va materialdagi ochiq xaridlar.
  // Taklif qilinadi, lekin bog'lash faqat foydalanuvchi tanlovi bilan (kalit bo'yicha eslab qolinadi).
  const linkKey = type === 'kirim' && objectId && materialId ? `${objectId}:${materialId}` : null
  const [openPurchases, setOpenPurchases] = useState<{ key: string; rows: OpenPurchase[] } | null>(null)
  const [linkChoice, setLinkChoice] = useState<{ key: string; id: string | null } | null>(null)
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
  // olib tashlanadi); bir nechta — foydalanuvchi tanlaydi
  const chosen = linkChoice !== null && linkChoice.key === linkKey ? linkChoice : null
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

  const chooseType = (next: EntryType) => {
    haptic.select()
    setType(next)
    saveEntryType(next)
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
    setFieldErrors({})
    setDraftId(uuid())
    geo.reset()
  }

  const save = useCallback(
    async (opts: { withoutPhoto?: boolean; confirmDuplicate?: boolean } = {}) => {
      // Sinxron qulf: MainButton va oddiy tugma tez-tez bosilsa ham bitta so'rov
      if (savingRef.current || !profile || preparingPhoto) return
      const draft = { type, objectId, materialId, unitId, qtyInput: qty }
      const nowIso = new Date().toISOString()
      const result = validateMovementDraft(draft, { nowIso, isAdmin })
      if (!result.ok || !objectId || !materialId || !unitId) {
        setFieldErrors(result.ok ? {} : result.errors)
        haptic.error()
        return
      }
      if (photoMissing) {
        haptic.error()
        return
      }
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
          photoSha256: photoPath ? (photo.photo?.sha256 ?? null) : null,
          geo: geoFix,
          ...(purchaseId ? { purchaseId } : {}),
        })
        haptic.success()
        saveLastObject(objectId)
        rememberLastEntry(profile.id, materialId, unitId, result.qtyInput)
        setRecent((list) => [row, ...list.filter((m) => m.id !== row.id)].slice(0, RECENT_LIMIT))
        setSavedText(
          tm.saved(
            t.movements.types[row.type === 'chiqim' ? 'chiqim' : 'kirim'],
            formatQty(row.qty_input),
            unitLabel({ unit: row.unit_input, variant: row.unit_variant }),
            row.material_name ?? material?.name ?? '',
            row.object_name ?? object?.name ?? '',
          ),
        )
        resetEntry()
      } catch (err) {
        haptic.error()
        // Rasm muammosi saqlashni to'xtatmasin: "Qayta urinish" yoki "Rasmsiz saqlash"
        if (!photo.handleSaveError(err)) setSaveError(errorText(err))
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    // resetEntry — faqat setState va photo.reset (photo deps ichida)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, preparingPhoto, type, objectId, materialId, unitId, qty, photo, linkedPurchaseId, draftId, note, material, object, isAdmin, photoMissing, qtyBase, recent, settings.duplicateWindowMinutes, geo],
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

  useBackButton(canGoBack && !incomingOpen ? onBack : null)
  useMainButton(
    duplicate ? ta.duplicateSave : tm.save,
    step === 'details' && !incomingOpen ? (duplicate ? saveDuplicate : onMainButton) : null,
    preparingPhoto || photoMissing,
    saving,
  )
  const insideTelegram = getWebApp() !== null

  if (!profile) return null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={tm.title} />

      {objects && objects.length > 0 && (
        <IncomingTransfers objectIds={objects.map((o) => o.id)} open={incomingOpen} onOpenChange={setIncomingOpen} />
      )}
      {!incomingOpen && (
        <>
          <EntryTypeSwitch value={type} onChange={chooseType} />

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
                    setFieldErrors((er) => ({ ...er, qty: undefined }))
                  }}
                  onUnit={(id) => {
                    haptic.select()
                    setUnitId(id)
                    setDuplicate(false)
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
    </div>
  )
}
