import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { Button, Notice, Spinner } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { createMovement } from '@/data/movementsRepo'
import { listObjects } from '@/data/objectsRepo'
import { isPhotoError, uploadPhoto } from '@/data/photosRepo'
import { getStock } from '@/data/stockRepo'
import type { Material, ObjectRow } from '@/data/types'
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
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { preparePhoto } from '@/lib/image'
import { uuid } from '@/lib/uuid'
import { MaterialGrid } from '../movement/MaterialGrid'
import { PhotoPicker, type PickedPhoto } from '../movement/PhotoPicker'
import { loadEntryType, loadLastObject, saveEntryType, saveLastObject } from '../movement/prefs'
import { getWebApp, haptic } from '../telegram'
import { useBackButton, useMainButton } from '../useTelegramButtons'

const tm = t.tg.movement
const ENTRY_TYPES: readonly EntryType[] = ['kirim', 'chiqim']
const USAGE_DAYS = 30

type Step = 'object' | 'material' | 'details'
type FieldErrors = Partial<Record<DraftField, DraftErrorCode>>

const retryClass = 'ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline'

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
  const [photo, setPhoto] = useState<PickedPhoto | null>(null)
  const [preparingPhoto, setPreparingPhoto] = useState(false)
  const [photoNotice, setPhotoNotice] = useState<string | null>(null)
  // Yuklangan rasm yo'li: saqlash xato bo'lsa, qayta urinishda qayta yuklanmaydi
  const [uploaded, setUploaded] = useState<{ blob: Blob; path: string } | null>(null)
  const [stock, setStock] = useState<{ key: string; value: string } | null>(null)
  // Qoralama id'si — qayta urinishda ikki marta yozilmasin (baza 23505 → saqlangan qator o'qiladi)
  const [draftId, setDraftId] = useState<string>(() => uuid())

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)

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
    setUnitId(m.units[0]?.id ?? null)
    setQty('')
    setStock(null)
    setFieldErrors({})
    setSaveError(null)
    setPhotoError(null)
    setSavedText(null)
  }

  const removePhoto = () => {
    setPhoto(null)
    setUploaded(null)
    setPhotoError(null)
  }

  const pickPhoto = async (file: File) => {
    setPhotoNotice(null)
    setPhotoError(null)
    setPreparingPhoto(true)
    try {
      const result = await preparePhoto(file, { maxSide: 1600, quality: 0.8 })
      if (result.ok) {
        setPhoto({ blob: result.blob, name: file.name })
        setUploaded(null)
      } else {
        // Ochib bo'lmaydigan yoki katta rasm — olib tashlanadi, forma saqlanadi
        setPhoto(null)
        setUploaded(null)
        setPhotoNotice(t.errors[result.reason])
      }
    } finally {
      setPreparingPhoto(false)
    }
  }

  const resetEntry = () => {
    setMaterialId(null)
    setUnitId(null)
    setQty('')
    setNote('')
    setPhoto(null)
    setUploaded(null)
    setPhotoNotice(null)
    setStock(null)
    setFieldErrors({})
    setDraftId(uuid())
  }

  const save = useCallback(
    async (opts: { withoutPhoto?: boolean } = {}) => {
      // Sinxron qulf: MainButton va oddiy tugma tez-tez bosilsa ham bitta so'rov
      if (savingRef.current || !profile || preparingPhoto) return
      const draft = { type, objectId, materialId, unitId, qtyInput: qty }
      const isAdmin = profile.role === 'admin' || profile.role === 'super_admin'
      const result = validateMovementDraft(draft, { nowIso: new Date().toISOString(), isAdmin })
      if (!result.ok || !objectId || !materialId || !unitId) {
        setFieldErrors(result.ok ? {} : result.errors)
        haptic.error()
        return
      }
      savingRef.current = true
      setSaving(true)
      setSaveError(null)
      setPhotoError(null)
      const usePhoto = opts.withoutPhoto ? null : photo
      if (opts.withoutPhoto) {
        setPhoto(null)
        setUploaded(null)
      }
      try {
        let photoPath: string | null = null
        if (usePhoto) {
          if (uploaded && uploaded.blob === usePhoto.blob) {
            photoPath = uploaded.path
          } else {
            photoPath = await uploadPhoto(usePhoto.blob, profile.company_id)
            setUploaded({ blob: usePhoto.blob, path: photoPath })
          }
        }
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
        })
        haptic.success()
        saveLastObject(objectId)
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
        if (isPhotoError(err)) {
          // Rasm muammosi saqlashni to'xtatmasin: "Qayta urinish" yoki "Rasmsiz saqlash"
          setUploaded(null)
          setPhotoError(errorText(err))
        } else {
          setSaveError(errorText(err))
        }
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [profile, preparingPhoto, type, objectId, materialId, unitId, qty, photo, uploaded, draftId, note, material, object],
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
      setPhotoError(null)
    } else if (step === 'object') {
      setPickingObject(false)
    } else if (step === 'material') {
      setPickingObject(true)
    }
  }, [step])
  const canGoBack = step === 'details' || (step === 'object' && Boolean(objectId)) || (step === 'material' && manyObjects)

  useBackButton(canGoBack ? onBack : null)
  useMainButton(tm.save, step === 'details' ? onMainButton : null, preparingPhoto, saving)
  const insideTelegram = getWebApp() !== null

  if (!profile) return null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-brand-dark">{tm.title}</h1>

      <div role="group" aria-label={tm.typeLabel} className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {ENTRY_TYPES.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={type === k}
            onClick={() => chooseType(k)}
            className={`min-h-12 rounded-xl text-base font-semibold ${
              type === k ? (k === 'kirim' ? 'bg-ok text-white' : 'bg-brand text-white') : 'text-slate-600'
            }`}
          >
            {t.movements.types[k]}
          </button>
        ))}
      </div>

      {savedText && (
        <div role="status" className="rounded-2xl border border-ok/30 bg-ok/5 p-4 text-ok">
          <p className="font-semibold">✓ {savedText}</p>
        </div>
      )}

      {loadError && (
        <Notice>
          {loadError}
          <button type="button" className={retryClass} onClick={() => setReloadKey((k) => k + 1)}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!loadError && (!objects || !materials) && <Spinner />}
      {objects && objects.length === 0 && <Notice tone="warn">{tm.noObjects}</Notice>}

      {objects && objects.length > 0 && materials && (
        <>
          {step === 'object' ? (
            <section className="flex flex-col gap-2" aria-label={tm.chooseObject}>
              <h2 className="text-sm font-semibold text-slate-700">{tm.chooseObject}</h2>
              {orderObjects(objects, loadLastObject()).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={o.id === objectId}
                  onClick={() => chooseObject(o.id)}
                  className={`min-h-14 rounded-2xl border px-4 text-left text-base font-semibold ${
                    o.id === objectId ? 'border-brand bg-brand-light text-brand-dark' : 'border-slate-200 text-slate-900'
                  }`}
                >
                  {o.name}
                </button>
              ))}
            </section>
          ) : (
            object && (
              <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-brand-light px-3 py-1 text-brand-dark">
                <span className="text-sm">
                  {tm.object}: <strong>{object.name}</strong>
                </span>
                {manyObjects && (
                  <button
                    type="button"
                    onClick={() => setPickingObject(true)}
                    className="min-h-11 px-2 text-sm font-medium text-brand"
                  >
                    {tm.change}
                  </button>
                )}
              </div>
            )
          )}

          {step === 'material' && <MaterialGrid materials={ranked} onPick={chooseMaterial} />}

          {step === 'details' && material && (
            <section className="flex flex-col gap-4" aria-label={material.name}>
              <div className="flex min-h-11 items-center justify-between gap-2">
                <p className="text-lg font-semibold text-slate-900">{material.name}</p>
                <button
                  type="button"
                  onClick={() => setMaterialId(null)}
                  className="min-h-11 px-2 text-sm font-medium text-brand"
                >
                  {tm.change}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="movement-qty" className="text-sm font-medium text-slate-700">
                  {tm.qty}
                </label>
                <input
                  id="movement-qty"
                  inputMode="decimal"
                  autoComplete="off"
                  value={qty}
                  aria-invalid={fieldErrors.qty ? true : undefined}
                  onChange={(e) => {
                    setQty(e.target.value)
                    setFieldErrors((er) => ({ ...er, qty: undefined }))
                  }}
                  className={`min-h-14 rounded-xl border px-4 text-2xl font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${
                    fieldErrors.qty ? 'border-danger' : 'border-slate-300'
                  }`}
                />
                {fieldErrors.qty && <p className="text-sm text-danger">{tm.errors.qty[fieldErrors.qty]}</p>}
              </div>

              <div role="group" aria-label={tm.unit} className="flex flex-wrap gap-2">
                {material.units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    aria-pressed={u.id === unitId}
                    onClick={() => {
                      haptic.select()
                      setUnitId(u.id)
                      setFieldErrors((er) => ({ ...er, unit: undefined }))
                    }}
                    className={`min-h-11 rounded-full border px-4 text-base ${
                      u.id === unitId ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800'
                    }`}
                  >
                    {unitLabel(u)}
                  </button>
                ))}
              </div>
              {fieldErrors.unit && <p className="text-sm text-danger">{tm.errors.unit}</p>}

              {qtyBase !== null && (
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-lg font-semibold text-slate-900">
                    {tm.equals(formatQty(qtyBase), material.base_unit)}
                  </p>
                  {type === 'chiqim' && currentStock !== null && (
                    <p className="text-sm text-slate-600">
                      {tm.stock(
                        formatQty(currentStock),
                        formatQty(stockAfter(currentStock, 'chiqim', qtyBase)),
                        material.base_unit,
                      )}
                    </p>
                  )}
                </div>
              )}
              {warnings[0] && <Notice tone="warn">{tm.warnings[warnings[0]]}</Notice>}

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{tm.photo}</span>
                <PhotoPicker
                  photo={photo}
                  busy={preparingPhoto || saving}
                  onPick={(f) => void pickPhoto(f)}
                  onRemove={removePhoto}
                />
                {preparingPhoto && <Spinner label={tm.preparingPhoto} />}
                {photoNotice && <Notice tone="warn">{photoNotice}</Notice>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="movement-note" className="text-sm font-medium text-slate-700">
                  {tm.note}
                </label>
                <textarea
                  id="movement-note"
                  rows={2}
                  value={note}
                  placeholder={tm.notePlaceholder}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>

              {fieldErrors.object && <Notice>{tm.errors.object}</Notice>}
              {saveError && (
                <Notice>
                  {saveError}
                  <button type="button" className={retryClass} onClick={onMainButton}>
                    {t.common.retry}
                  </button>
                </Notice>
              )}
              {photoError && (
                <div role="alert" className="flex flex-col gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3">
                  <p className="text-sm text-danger">{photoError}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={saving} onClick={onMainButton}>
                      {t.common.retry}
                    </Button>
                    <Button variant="primary" disabled={saving} onClick={saveWithoutPhoto}>
                      {tm.saveWithoutPhoto}
                    </Button>
                  </div>
                </div>
              )}

              {!insideTelegram && (
                <Button className="min-h-12 text-base" onClick={onMainButton} disabled={saving || preparingPhoto}>
                  {saving ? t.common.saving : tm.save}
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** Oxirgi ishlatilgan obyekt birinchi, qolganlari nom bo'yicha (listObjects tartibi). */
function orderObjects(objects: ObjectRow[], lastUsed: string | null): ObjectRow[] {
  const last = objects.find((o) => o.id === lastUsed)
  return last ? [last, ...objects.filter((o) => o.id !== lastUsed)] : objects
}
