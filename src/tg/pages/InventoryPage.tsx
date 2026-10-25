import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { ClipboardCheck, ClipboardList, Plus, TriangleAlert } from 'lucide-react'
import { BottomSheet, Button, Notice, PageHeader, SkeletonRows } from '@/components/ui'
import {
  createCount,
  listCandidateMaterials,
  listCountItems,
  listCounts,
  saveCountItem,
  submitCount,
} from '@/data/inventoryRepo'
import type { InventoryCount, InventoryCountItem, Material, Profile } from '@/data/types'
import { defaultObjectId, type DraftErrorCode } from '@/domain/movements'
import { toBaseQty, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { MaterialHeader, QtyField } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
import { useEntryData } from '../entry/useEntryData'
import { useRankedMaterials } from '../entry/useRankedMaterials'
import { CountMaterialList } from '../inventory/CountMaterialList'
import { getWebApp, haptic } from '../telegram'
import { LoadError, SavedBanner } from '../ui'
import { useBackButton, useMainButton } from '../useTelegramButtons'

const ti = t.tg.inventory

/** Bitta material: sanalgan miqdor + birlik. Kutilgan qoldiq ko'rsatilmaydi. Saqlash — darhol qoralamaga. */
function CountItemForm({
  profile,
  countId,
  material,
  existing,
  onSaved,
  onCancel,
}: {
  profile: Profile
  countId: string
  material: Material
  existing: InventoryCountItem | null
  onSaved: (item: InventoryCountItem) => void
  onCancel: () => void
}) {
  const initialUnit = material.units.find((u) => u.id === existing?.unit_id) ?? material.units[0] ?? null
  const [unitId, setUnitId] = useState<string | null>(initialUnit?.id ?? null)
  const [qty, setQty] = useState(() => (existing?.qty_input ? existing.qty_input.replace('.', ',') : ''))
  const [qtyError, setQtyError] = useState<DraftErrorCode | undefined>()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  // Yangi qator id'si — qayta urinishda ikkinchi qator yaratilmasin
  const [newId] = useState(() => uuid())

  const unit = material.units.find((u) => u.id === unitId) ?? null
  const parsed = validateQtyInput(qty)
  // Sanalgan 0 ham to'g'ri (material yo'q)
  const zero = qty.trim() !== '' && parsed.ok === false && parsed.reason === 'zero'
  const value = parsed.ok ? parsed.value : zero ? '0' : null
  const qtyBase = value !== null && unit ? toBaseQty(value, unit.factor) : null

  const save = useCallback(async () => {
    if (savingRef.current) return
    if (value === null || !unitId) {
      setQtyError(parsed.ok ? undefined : parsed.reason === 'empty' ? 'required' : parsed.reason)
      haptic.error()
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const item = await saveCountItem({
        id: existing?.id ?? newId,
        exists: existing !== null,
        companyId: profile.company_id,
        countId,
        materialId: material.id,
        unitId,
        qtyInput: value,
      })
      haptic.success()
      onSaved(item)
    } catch (err) {
      haptic.error()
      setError(errorText(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [value, unitId, parsed, existing, newId, profile.company_id, countId, material.id, onSaved])

  const onMain = useCallback(() => void save(), [save])
  useMainButton(ti.save, onMain, false, saving)
  useBackButton(onCancel)
  const insideTelegram = getWebApp() !== null

  return (
    <section className="flex flex-col gap-4" aria-label={material.name}>
      <MaterialHeader name={material.name} onChange={onCancel} />
      <QtyField
        label={ti.qty}
        value={qty}
        error={qtyError}
        onChange={(v) => {
          setQty(v)
          setQtyError(undefined)
        }}
      />
      <UnitChips
        units={material.units}
        selectedId={unitId}
        onPick={(id) => {
          haptic.select()
          setUnitId(id)
        }}
      />
      {qtyBase !== null && <BaseQtyBox qtyBase={qtyBase} unit={unit} baseUnit={material.base_unit} />}
      {error && <Notice>{error}</Notice>}
      {!insideTelegram && (
        <Button size="lg" onClick={onMain} loading={saving}>
          {saving ? t.common.saving : ti.save}
        </Button>
      )}
    </section>
  )
}

/** Sanash (qoralama): materiallar ro'yxati, har biri darhol saqlanadi, oxirida "Yakunlash". */
function CountSession({
  profile,
  count,
  materials,
  onFinished,
  onExit,
}: {
  profile: Profile
  count: InventoryCount
  materials: Material[]
  onFinished: (hasShortage: boolean) => void
  onExit: () => void
}) {
  const [items, setItems] = useState<InventoryCountItem[] | null>(null)
  const [relevant, setRelevant] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listCountItems(count.id)
      .then((list) => {
        if (!alive) return
        setItems(list)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [count.id, reloadKey])

  // Obyektdagi materiallar (RPC `inventory_candidate_materials`): qoldig'i bor yoki smetada — faqat id'lar,
  // miqdorsiz. Qoldiq, harakatlar va norma tekshiruvchiga umuman so'ralmaydi (ko'r-ko'rona sanash).
  useEffect(() => {
    let alive = true
    listCandidateMaterials(count.object_id)
      .then((ids) => alive && setRelevant(new Set(ids)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [count.object_id])

  const byMaterial = useMemo(() => new Map((items ?? []).map((i) => [i.material_id, i])), [items])
  const countedIds = useMemo(() => new Set(byMaterial.keys()), [byMaterial])
  const material = materials.find((m) => m.id === materialId) ?? null

  const onItemSaved = useCallback(
    (item: InventoryCountItem) => {
      setItems((list) => [...(list ?? []).filter((i) => i.id !== item.id && i.material_id !== item.material_id), item])
      setSavedText(ti.savedItem(material?.name ?? item.material_name ?? ''))
      setMaterialId(null)
    },
    [material],
  )
  const cancelItem = useCallback(() => setMaterialId(null), [])
  // Ro'yxatda — Telegram "Orqaga" sanashdan chiqadi (qoralama saqlangan); material ochiq bo'lsa — forma o'zi
  useBackButton(material ? null : onExit)

  const finish = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Natija: faqat "kamomad bormi" — raqamlar tekshiruvchiga qaytarilmaydi
      const result = await submitCount(count.id)
      haptic.success()
      onFinished(result.hasShortage)
    } catch (err) {
      haptic.error()
      setSubmitError(errorText(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (material) {
    return (
      <CountItemForm
        key={material.id}
        profile={profile}
        countId={count.id}
        material={material}
        existing={byMaterial.get(material.id) ?? null}
        onSaved={onItemSaved}
        onCancel={cancelItem}
      />
    )
  }

  const n = countedIds.size
  // Obyektdagi, lekin sanalmagan materiallar — yakunlashda kamomad sifatida hisoblanadi
  const notCounted = [...relevant].filter((id) => !countedIds.has(id)).length
  return (
    <div className="flex flex-col gap-4">
      {error && <LoadError message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!items && !error && <SkeletonRows rows={3} />}
      {items && (
        <>
          <p className="text-sm text-muted">{ti.hint}</p>
          {savedText && (
            <SavedBanner>{savedText}</SavedBanner>
          )}
          <p data-testid="counted-count" className="flex items-center gap-2 text-base font-semibold text-ink">
            <ClipboardCheck aria-hidden className="size-5 text-ok" strokeWidth={1.75} />
            {ti.counted(n)}
          </p>
          <CountMaterialList
            materials={materials}
            relevantIds={relevant}
            countedIds={countedIds}
            onPick={(m) => {
              haptic.tap()
              setSavedText(null)
              setMaterialId(m.id)
            }}
          />
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setSubmitError(null)
              setConfirming(true)
            }}
          >
            {ti.finish}
          </Button>
        </>
      )}
      {confirming && (
        <BottomSheet
          title={ti.confirmTitle}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </Button>
              <Button size="lg" className="flex-1" disabled={n === 0} loading={submitting} onClick={() => void finish()}>
                {submitting ? t.common.saving : ti.confirm}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 px-2 pb-1">
            <p className="text-base text-ink">{n === 0 ? ti.nothingCounted : ti.confirmText(n)}</p>
            {notCounted > 0 && (
              <div data-testid="not-counted" className="flex gap-2.5 rounded-xl border border-warn/25 bg-warn-bg px-4 py-3 text-sm text-warn">
                <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
                <div>
                  <p className="font-semibold">{ti.notCounted(notCounted)}</p>
                  <p>{ti.notCountedWarn}</p>
                </div>
              </div>
            )}
            {submitError && <Notice>{submitError}</Notice>}
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

type Phase = { kind: 'start' } | { kind: 'count'; count: InventoryCount } | { kind: 'result'; shortage: boolean }

/** Mini App: inventarizatsiya (tekshiruvchi, admin) — obyekt → yangi sanash yoki qoralamani davom ettirish. */
export function InventoryPage() {
  const { profile } = useAuth()
  const { objects, materials: catalog, error, reload } = useEntryData(profile?.company_id)
  // Batch 12 (L): ko'p ishlatilganlar birinchi
  const materials = useRankedMaterials(catalog)
  const [objectId, setObjectId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'start' })
  const [drafts, setDrafts] = useState<InventoryCount[] | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [newCountId, setNewCountId] = useState(() => uuid())

  const effectiveObjectId = objectId ?? (objects ? defaultObjectId(objects.map((o) => o.id)) : null)
  const object = objects?.find((o) => o.id === effectiveObjectId) ?? null
  const manyObjects = (objects?.length ?? 0) > 1
  const profileId = profile?.id

  useEffect(() => {
    if (!effectiveObjectId || !profileId || phase.kind !== 'start') return
    let alive = true
    listCounts({ objectId: effectiveObjectId, status: 'draft', createdBy: profileId })
      .then((r) => {
        if (!alive) return
        setDrafts(r.rows)
        setDraftError(null)
      })
      .catch((err: unknown) => alive && setDraftError(errorText(err)))
    return () => {
      alive = false
    }
  }, [effectiveObjectId, profileId, phase.kind])

  const backToStart = useCallback(() => {
    setDrafts(null)
    setPhase({ kind: 'start' })
  }, [])
  const showObjects = useCallback(() => setPicking(true), [])
  const back = picking ? () => setPicking(false) : manyObjects && object ? showObjects : null
  useBackButton(phase.kind === 'start' ? back : null)

  if (!profile) return null

  const startNew = async () => {
    if (!effectiveObjectId) return
    setStarting(true)
    setDraftError(null)
    try {
      const count = await createCount({ id: newCountId, companyId: profile.company_id, objectId: effectiveObjectId })
      haptic.success()
      setNewCountId(uuid())
      setPhase({ kind: 'count', count })
    } catch (err) {
      haptic.error()
      setDraftError(errorText(err))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={ti.title} />
      {error && <LoadError message={error} onRetry={reload} />}
      {!error && (!objects || !materials) && <SkeletonRows rows={3} />}
      {objects && objects.length === 0 && <Notice tone="warn">{ti.noObjects}</Notice>}

      {objects && objects.length > 0 && materials && (
        <>
          {(picking || !object) && phase.kind === 'start' ? (
            <ObjectChooser
              objects={objects}
              selectedId={effectiveObjectId}
              lastUsed={null}
              onPick={(id) => {
                haptic.tap()
                setObjectId(id)
                setDrafts(null)
                setPicking(false)
              }}
            />
          ) : (
            object && (
              <ObjectBar
                object={object}
                onChange={manyObjects && phase.kind === 'start' ? () => setPicking(true) : null}
              />
            )
          )}

          {phase.kind === 'start' && object && !picking && (
            <section className="flex flex-col gap-3">
              {draftError && <Notice>{draftError}</Notice>}
              {!drafts && !draftError && <SkeletonRows rows={1} />}
              {drafts?.map((d) => (
                <Button
                  key={d.id}
                  variant="secondary"
                  size="lg"
                  className="justify-start whitespace-normal text-left"
                  icon={<ClipboardList aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={1.75} />}
                  onClick={() => {
                    haptic.tap()
                    setPhase({ kind: 'count', count: d })
                  }}
                >
                  {ti.continueDraft(formatDateTime(d.created_at), d.item_count)}
                </Button>
              ))}
              <Button
                size="lg"
                loading={starting}
                icon={<Plus aria-hidden className="size-5" strokeWidth={2} />}
                onClick={() => void startNew()}
              >
                {starting ? t.common.saving : ti.newCount}
              </Button>
            </section>
          )}

          {phase.kind === 'count' && (
            <CountSession
              key={phase.count.id}
              profile={profile}
              count={phase.count}
              materials={materials}
              onFinished={(shortage) => setPhase({ kind: 'result', shortage })}
              onExit={backToStart}
            />
          )}

          {phase.kind === 'result' && (
            <section role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-paper px-5 py-8 text-center">
              <span
                aria-hidden
                className={`inline-flex size-16 items-center justify-center rounded-full ${phase.shortage ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}
              >
                {phase.shortage ? <TriangleAlert className="size-8" strokeWidth={1.5} /> : <ClipboardCheck className="size-8" strokeWidth={1.5} />}
              </span>
              <p className="text-lg font-semibold text-ink">{ti.resultTitle}</p>
              <p data-testid="inventory-result" className="max-w-xs text-base text-muted">
                {phase.shortage ? ti.resultShortage : ti.resultOk}
              </p>
              <Button variant="secondary" size="lg" className="mt-2 self-stretch" onClick={backToStart}>
                {ti.again}
              </Button>
            </section>
          )}
        </>
      )}
    </div>
  )
}
