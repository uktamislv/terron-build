// Tuzatish formasining holati va saqlash (veb dialogi va Telegram ilovasi varag'i uchun umumiy).
// Tekshiruv — `validateCorrection` (src/domain/corrections.ts); RPC — `correctEntry` (src/data).
import { useEffect, useState } from 'react'
import { correctEntry, type CorrectableTable } from '@/data/correctionsRepo'
import { getMaterial, listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import type { Material, ObjectRow } from '@/data/types'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { validateCorrection, type CorrectionError, type CorrectionErrorField } from '@/domain/corrections'
import { formatDecUz, toBaseQty, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'

const tc = t.correction

export interface CorrectionTarget {
  table: CorrectableTable
  id: string
  materialId: string
  materialName: string | null
  /** Yozuv obyekti (muallif boshqa obyektga ko'chira oladi). */
  objectId?: string
  qtyInput: string
  unitId: string
  /** Faqat xarid. */
  totalAmount?: string | null
  note: string | null
}

export function correctionErrorMessage(field: CorrectionErrorField, code: CorrectionError): string {
  if (field === 'reason') return tc.errReason
  if (field === 'unit') return tc.errUnit
  if (field === 'total') return code === 'required' ? tc.errTotalRequired : tc.errTotal
  return code === 'required' ? tc.errQtyRequired : (t.tg.movement.errors.qty[code as keyof typeof t.tg.movement.errors.qty] ?? tc.errQty)
}

/**
 * `allowMove` — muallif (30 daqiqa): material va obyektni ham o'zgartira oladi (correct_entry p_material_id /
 * p_object_id). Admin — faqat miqdor, birlik, summa (allowMove: false).
 */
export function useCorrectionForm(target: CorrectionTarget, onDone: () => void, allowMove = false) {
  const [materialId, setMaterialIdState] = useState(target.materialId)
  const [objectId, setObjectId] = useState(target.objectId ?? '')
  const [choices, setChoices] = useState<{ materials: Material[]; objects: ObjectRow[] } | null>(null)
  const [material, setMaterial] = useState<Material | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const initialQty = formatDecUz(target.qtyInput).replace(/\u202F/g, '')
  const initialTotal = target.totalAmount ? formatSumInput(target.totalAmount.replace('.', ',')) : ''
  const [qty, setQtyState] = useState(initialQty)
  const [unitId, setUnitIdState] = useState<string>(target.unitId)
  const [total, setTotalState] = useState(initialTotal)
  const [reason, setReasonState] = useState('')
  const [note, setNote] = useState(target.note ?? '')
  const [errors, setErrors] = useState<Partial<Record<CorrectionErrorField, CorrectionError>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getMaterial(materialId)
      .then((m) => {
        if (!alive) return
        setMaterial(m)
        // Boshqa material tanlandi — birlik shu materialniki bo'lishi shart: asosiy birlik tanlanadi
        if (m && !m.units.some((u) => u.id === unitId)) {
          const base = m.units.find((u) => u.unit === m.base_unit && !u.variant) ?? m.units[0]
          setUnitIdState(base?.id ?? '')
        }
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
    // unitId — faqat material yuklanganda tekshiriladi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, reloadKey])

  // Muallif: material va obyekt tanlovlari (faol, shu firma)
  useEffect(() => {
    if (!allowMove) return
    let alive = true
    Promise.resolve()
      .then(() => Promise.all([listMaterials(), listObjects()]))
      .then(([mats, objs]) => {
        if (!alive) return
        setChoices({
          materials: mats.filter((m) => m.is_active || m.id === target.materialId).sort((a, b) => a.name.localeCompare(b.name, 'uz')),
          objects: objs.filter((o) => o.status === 'faol' || o.id === target.objectId),
        })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [allowMove, target.materialId, target.objectId])

  const clear = (field: CorrectionErrorField) => setErrors((er) => ({ ...er, [field]: undefined }))
  const unit = material?.units.find((u) => u.id === unitId) ?? null
  const parsed = validateQtyInput(qty)
  const qtyBase = parsed.ok && unit ? toBaseQty(parsed.value, unit.factor) : null
  const totalValue = target.table === 'purchases' ? parseSumInput(total) : null
  // Qoralama o'zgardi — Telegram yopishdan oldin so'raydi
  const dirty =
    qty !== initialQty ||
    unitId !== target.unitId ||
    total !== initialTotal ||
    reason.trim() !== '' ||
    note !== (target.note ?? '') ||
    materialId !== target.materialId ||
    objectId !== (target.objectId ?? '')

  const submit = async () => {
    if (saving) return false
    const result = validateCorrection({
      // Xarajat — alohida forma (ExpenseCorrectionForm); bu yerda faqat harakat va xarid
      table: target.table === 'movements' ? 'movements' : 'purchases',
      original: {
        qtyInput: target.qtyInput,
        unitId: target.unitId,
        totalAmount: target.totalAmount ?? null,
        note: target.note,
        materialId: target.materialId,
        objectId: target.objectId,
      },
      materialId: allowMove ? materialId : null,
      objectId: allowMove ? objectId || null : null,
      qtyInput: qty,
      unitId,
      totalInput: target.table === 'purchases' ? total : undefined,
      reason,
      note,
    })
    if (!result.ok) {
      setErrors(result.errors)
      return false
    }
    setSaving(true)
    setSaveError(null)
    try {
      await correctEntry({ table: target.table, id: target.id, ...result.value })
      onDone()
      return true
    } catch (err) {
      setSaveError(errorText(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  return {
    allowMove,
    choices,
    materialId,
    setMaterialId: (id: string) => {
      setMaterialIdState(id)
      clear('unit')
    },
    objectId,
    setObjectId,
    material,
    unit,
    loadError,
    reload: () => setReloadKey((k) => k + 1),
    qty,
    setQty: (v: string) => {
      setQtyState(v)
      clear('qty')
    },
    unitId,
    setUnitId: (id: string) => {
      setUnitIdState(id)
      clear('unit')
    },
    total,
    totalValue,
    setTotal: (v: string) => {
      setTotalState(formatSumInput(v))
      clear('total')
    },
    reason,
    setReason: (v: string) => {
      setReasonState(v)
      clear('reason')
    },
    note,
    setNote,
    qtyBase,
    errors,
    saving,
    saveError,
    dirty,
    submit,
  }
}
