// Mini App ko'rgazma ekranlari (komponentlar; ro'yxat — tg.tsx) — haqiqiy taqdimot komponentlari namuna ma'lumot bilan (repo chaqirilmaydi).
import { useState } from 'react'
import { PageHeader } from '@/components/ui'
import type { DashboardSummary } from '@/data/reportsRepo'
import type { Alert, Material, MaterialUnit, Movement, OpenPurchase, Supplier } from '@/data/types'
import type { EntryType } from '@/domain/movements'
import { toBaseQty, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import type { Loaded } from '@/lib/useLoad'
import { ObjectBar } from '@/tg/entry/ObjectPicker'
import { DirectorHomeView, type DirectorPeriod } from '@/tg/home/DirectorHome'
import { objectUsage } from '@/tg/home/usage'
import { WorkerHomeView } from '@/tg/home/WorkerHome'
import { EntryTypeSwitch } from '@/tg/movement/EntryTypeSwitch'
import { MovementDetails } from '@/tg/movement/MovementDetails'
import { BalanceCard, PurchaseDetails } from '@/tg/purchase/PurchaseDetails'
import type { SupplierChoice } from '@/tg/purchase/SupplierPicker'
import { hoursAgo, PREVIEW_COMPANY, previewMaterials, previewObjects } from '../fixtures'

const stamp = '2026-10-01T05:00:00Z'
const noop = () => undefined

function loaded<T>(data: T): Loaded<T> {
  return { data, error: null, loading: false, reload: noop }
}

function unit(id: string, materialId: string, name: string, factor: string, variant: string | null = null): MaterialUnit {
  return { id, company_id: PREVIEW_COMPANY, material_id: materialId, unit: name, factor, variant, created_at: stamp, updated_at: stamp }
}

const cement: Material = {
  ...previewMaterials[0]!,
  units: [unit('u-kg', 'm-1', 'kg', '1'), unit('u-qop', 'm-1', 'qop', '50'), unit('u-t', 'm-1', 't', '1000')],
}

function movement(id: string, type: Movement['type'], material: string, qtyIn: string, unitIn: string, qtyBase: string, baseUnit: string, h: number, object = previewObjects[0]!.name): Movement {
  return {
    id,
    company_id: PREVIEW_COMPANY,
    type,
    object_id: 'o-1',
    material_id: 'm-1',
    unit_id: 'u',
    qty_input: qtyIn,
    unit_input: unitIn,
    unit_variant: null,
    qty_base: qtyBase,
    purchase_id: null,
    photo_path: null,
    occurred_at: hoursAgo(h),
    note: null,
    created_by: 'pv-prorab',
    created_at: hoursAgo(h),
    deleted_at: null,
    object_name: object,
    material_name: material,
    base_unit: baseUnit,
    created_by_name: 'Aziz Karimov',
  }
}

const todayRows: Movement[] = [
  movement('t1', 'kirim', 'Sement M400', '30', 'qop', '1500', 'kg', 0.3),
  movement('t2', 'chiqim', 'G‘isht (pishiq)', '2400', 'dona', '2400', 'dona', 1.2),
  movement('t3', 'kirim', 'Armatura Ø12', '1.2', 't', '1200', 'kg', 2.5, previewObjects[1]!.name),
]

const summary: DashboardSummary = {
  kirim_count: 14,
  chiqim_count: 9,
  purchases_count: 6,
  purchases_sum: '48250000',
  cash_issued_sum: '60000000',
  cash_returned_sum: '0',
  cash_on_hand_total: '11750000',
  alerts_open: 5,
  alerts_serious_open: 2,
  alerts_new_in_period: 3,
  unreceived_purchases_count: 1,
  pending_transfers_count: 2,
  pending_requests_count: 3,
  objects_over_norm_count: 1,
  cash_outstanding_sum: '0',
  cash_owed_to_staff_sum: '0',
  telegram_blocked_count: 0,
  telegram_me_blocked: false,
}

function norm(objectId: string, objectName: string, materialId: string, materialName: string, allowed: string, consumed: string) {
  return {
    object_id: objectId,
    object_name: objectName,
    material_id: materialId,
    material_name: materialName,
    base_unit: 'kg',
    norm_qty_base: allowed,
    allowed_qty_base: allowed,
    consumed_qty_base: consumed,
    usage_pct: null,
  }
}

const usage = objectUsage([
  norm('o-1', previewObjects[0]!.name, 'm-1', 'Sement M400', '12000', '7400'),
  norm('o-1', previewObjects[0]!.name, 'm-5', 'Armatura Ø12', '5000', '5650'),
  norm('o-2', previewObjects[1]!.name, 'm-1', 'Sement M400', '20000', '9100'),
  norm('o-2', previewObjects[1]!.name, 'm-2', 'G‘isht', '40000', '36200'),
  norm('o-3', previewObjects[2]!.name, 'm-3', 'Qum', '300', '96'),
])

function alert(id: string, type: Alert['type'], severity: Alert['severity'], details: Record<string, unknown>, h: number, objectName: string): Alert {
  return {
    id,
    company_id: PREVIEW_COMPANY,
    type,
    status: 'yangi',
    severity,
    object_id: 'o-1',
    material_id: 'm-1',
    purchase_id: null,
    movement_id: null,
    details,
    closed_by: null,
    closed_at: null,
    close_note: null,
    created_at: hoursAgo(h),
    deleted_at: null,
    object_name: objectName,
    material_name: 'Sement M400',
    base_unit: 'kg',
  }
}

const alerts: Alert[] = [
  alert('a1', 'xarid_qabul_farqi', 'jiddiy', { purchased_qty_base: '1500', received_qty_base: '1350', diff_pct: '10', threshold_pct: '3', direction: 'under' }, 1, previewObjects[0]!.name),
  alert('a2', 'narx_ogishi', 'ogohlantirish', { avg: '1250', price: '1390', diff_pct: '11.2', window: 5 }, 5, previewObjects[1]!.name),
  alert('a3', 'normadan_oshish', 'ogohlantirish', { allowed_qty_base: '5000', consumed_qty_base: '5650', over_pct: '13', base_unit: 'kg' }, 26, previewObjects[0]!.name),
]

export function DirectorPreview() {
  const [period, setPeriod] = useState<DirectorPeriod>('today')
  return (
    <DirectorHomeView
      name="Bahodir Yusupov"
      period={period}
      onPeriod={setPeriod}
      summary={loaded(summary)}
      usage={loaded(usage)}
      alerts={loaded(alerts)}
      onPickObject={noop}
    />
  )
}

const openPurchases: OpenPurchase[] = []

export function MovementPreview() {
  const [type, setType] = useState<EntryType>('kirim')
  const [unitId, setUnitId] = useState<string | null>('u-qop')
  const [qty, setQty] = useState('3')
  const [note, setNote] = useState('')
  const u = cement.units.find((x) => x.id === unitId) ?? null
  const parsed = validateQtyInput(qty)
  const qtyBase = parsed.ok && u ? toBaseQty(parsed.value, u.factor) : null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.tg.movement.title} />
      <EntryTypeSwitch value={type} onChange={setType} />
      <ObjectBar object={previewObjects[0]!} onChange={noop} />
      <MovementDetails
        type={type}
        material={cement}
        unitId={unitId}
        unit={u}
        qty={qty}
        qtyBase={qtyBase}
        stock={type === 'chiqim' && qtyBase !== null ? { current: '4200', after: String(4200 - Number(qtyBase)) } : null}
        warning={null}
        openPurchases={openPurchases}
        linkedPurchaseId={null}
        note={note}
        photo={{ photo: null, notice: null, error: null, preparing: false }}
        saving={false}
        saveError={null}
        showSaveButton
        onQty={setQty}
        onUnit={setUnitId}
        onNote={setNote}
        onChangeMaterial={noop}
        onSelectLinked={noop}
        onPickPhoto={noop}
        onRemovePhoto={noop}
        onSave={noop}
        onSaveWithoutPhoto={noop}
      />
    </div>
  )
}

const suppliers: Supplier[] = ['Chilonzor bozori', 'Qurilish Savdo MChJ', 'Sergeli baza'].map((name, i) => ({
  id: `s-${i}`,
  company_id: PREVIEW_COMPANY,
  name,
  phone: null,
  note: null,
  created_at: stamp,
  deleted_at: null,
}))

export function PurchasePreview() {
  const [unitId, setUnitId] = useState<string | null>('u-qop')
  const [qty, setQty] = useState('30')
  const [sum, setSum] = useState('1 875 000')
  const [supplier, setSupplier] = useState<SupplierChoice>({ kind: 'existing', id: 's-0' })
  const [note, setNote] = useState('')
  const u = cement.units.find((x) => x.id === unitId) ?? null
  const parsed = validateQtyInput(qty)
  const qtyBase = parsed.ok && u ? toBaseQty(parsed.value, u.factor) : null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.tg.purchase.title} />
      <BalanceCard balance={{ value: '3250000', failed: false }} />
      <ObjectBar object={previewObjects[0]!} onChange={noop} />
      <PurchaseDetails
        material={cement}
        unitId={unitId}
        unit={u}
        qty={qty}
        sum={sum}
        errors={{}}
        qtyBase={qtyBase}
        perBaseText={t.tg.purchase.perBase('kg', '1 250 so‘m')}
        priceVerdict="high"
        suppliers={suppliers}
        supplier={supplier}
        note={note}
        photo={{ photo: null, notice: null, error: null, preparing: false }}
        saving={false}
        saveError={null}
        showSaveButton
        onQty={setQty}
        onUnit={setUnitId}
        onSum={(raw) => setSum(raw)}
        onSupplier={setSupplier}
        onNote={setNote}
        onChangeMaterial={noop}
        onPickPhoto={noop}
        onRemovePhoto={noop}
        onSave={noop}
        onSaveWithoutPhoto={noop}
      />
    </div>
  )
}

export function ProrabHomePreview() {
  return <WorkerHomeView name="Aziz Karimov" roleLabel={t.roles.prorab} today={loaded(todayRows)} onStart={noop} />
}
