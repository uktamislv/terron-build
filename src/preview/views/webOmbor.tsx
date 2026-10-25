/* eslint-disable react-refresh/only-export-components -- ko‘rgazma: fayl ro‘yxat (views) va ichki ekranlarni birga saqlaydi */
// Ko'rgazma: Ombor/Harakatlar, Xaridlar, Ogohlantirishlar — haqiqiy taqdimot komponentlari fixture bilan.
import { useState } from 'react'
import { Button } from '@/components/ui'
import type { Alert, AlertSeverity, AlertStatus, AlertType, Movement, MovementKind, Purchase } from '@/data/types'
import { t } from '@/i18n'
import { EMPTY_FILTERS, type MovementFilterForm } from '@/web/movements/movementFilters'
import { MovementsTabView } from '@/web/movements/MovementsTab'
import { AlertsView, type AlertFilterForm } from '@/web/pages/AlertsPage'
import { OmborShell, type OmborTab } from '@/web/pages/MovementsPage'
import { PurchasesView, type PurchaseFilterForm } from '@/web/pages/PurchasesPage'
import { hoursAgo, PREVIEW_COMPANY, previewMaterials, previewObjects, previewProfile } from '../fixtures'
import type { PreviewView } from '../types'

const [o1, o2, o3] = previewObjects as [(typeof previewObjects)[number], (typeof previewObjects)[number], (typeof previewObjects)[number]]
const mat = (i: number) => previewMaterials[i]!
const profiles = [previewProfile('prorab', 'Bekzod Rahimov'), previewProfile('omborchi', 'Dilshod Ergashev'), previewProfile('haydovchi', 'Sardor Aliyev')]

function mv(
  id: string,
  type: MovementKind,
  objectIdx: 0 | 1 | 2,
  matIdx: number,
  qtyInput: string,
  unitInput: string,
  qtyBase: string,
  h: number,
  extra: Partial<Movement> = {},
): Movement {
  const o = previewObjects[objectIdx]!
  const m = mat(matIdx)
  return {
    id,
    company_id: PREVIEW_COMPANY,
    type,
    object_id: o.id,
    material_id: m.id,
    unit_id: `u-${id}`,
    qty_input: qtyInput,
    unit_input: unitInput,
    unit_variant: null,
    qty_base: qtyBase,
    purchase_id: null,
    photo_path: null,
    occurred_at: hoursAgo(h),
    note: null,
    created_by: profiles[0]!.id,
    created_at: hoursAgo(h),
    deleted_at: null,
    object_name: o.name,
    material_name: m.name,
    base_unit: m.base_unit,
    created_by_name: profiles[0]!.full_name,
    ...extra,
  }
}

const movements: Movement[] = [
  mv('mv1', 'kirim', 0, 0, '30', 'qop', '1500', 1, { note: 'Mashina 01 A 777 AA', photo_path: 'x.jpg' }),
  mv('mv2', 'chiqim', 0, 4, '1.2', 't', '1200', 3, { created_by_name: profiles[1]!.full_name }),
  mv('mv3', 'kirim', 1, 1, '12000', 'dona', '12000', 5),
  mv('mv4', 'chiqim', 1, 2, '4.5', 'm³', '4.5', 26),
  mv('mv5', 'transfer_out', 2, 0, '10', 'qop', '500', 30),
  mv('mv6', 'transfer_in', 0, 0, '10', 'qop', '500', 29),
  mv('mv7', 'inventory_adjust', 1, 6, '-6', 'm²', '-6', 50),
  mv('mv8', 'chiqim', 0, 5, '8', 'm³', '8', 52, { deleted_at: hoursAgo(40) }),
]

function MovementsPreview() {
  const [tab, setTab] = useState<OmborTab>('movements')
  const [form, setForm] = useState<MovementFilterForm>(EMPTY_FILTERS)
  return (
    <OmborShell tab={tab} onTab={setTab}>
      <MovementsTabView
        rows={movements}
        total={movements.length}
        page={0}
        onPage={() => undefined}
        form={form}
        onFilter={(patch) => setForm((f) => ({ ...f, ...patch }))}
        objects={previewObjects}
        materials={previewMaterials}
        profiles={profiles}
        isAdmin
        canSeeDeleted
        onShowPhoto={() => undefined}
        onDelete={() => undefined}
        onRestore={() => undefined}
        exportSlot={<Button variant="secondary">{t.excel.button}</Button>}
      />
    </OmborShell>
  )
}

function pu(
  id: string,
  objectIdx: 0 | 1 | 2,
  matIdx: number,
  qtyInput: string,
  unitInput: string,
  qtyBase: string,
  total: string,
  received: string | null,
  h: number,
  extra: Partial<Purchase> = {},
): Purchase {
  const o = previewObjects[objectIdx]!
  const m = mat(matIdx)
  return {
    id,
    company_id: PREVIEW_COMPANY,
    buyer_id: profiles[2]!.id,
    object_id: o.id,
    material_id: m.id,
    supplier_id: null,
    unit_id: `u-${id}`,
    qty_input: qtyInput,
    unit_input: unitInput,
    unit_variant: null,
    qty_base: qtyBase,
    total_amount: total,
    unit_price: String(Math.round(Number(total) / Number(qtyInput))),
    price_per_base: String(Math.round(Number(total) / Number(qtyBase))),
    receipt_photo_path: id === 'p1' || id === 'p3' ? 'r.jpg' : null,
    purchased_at: hoursAgo(h),
    note: null,
    created_by: profiles[2]!.id,
    created_at: hoursAgo(h),
    deleted_at: null,
    object_name: o.name,
    material_name: m.name,
    base_unit: m.base_unit,
    buyer_name: profiles[2]!.full_name,
    supplier_name: 'Qurilish bozori, 14-do‘kon',
    receipt:
      received === null
        ? null
        : { received_qty_base: received, remaining_qty_base: String(Number(qtyBase) - Number(received)), receipt_count: 1, last_received_at: hoursAgo(h - 1) },
    alert_types: [],
    ...extra,
  }
}

const purchases: Purchase[] = [
  pu('p1', 0, 0, '30', 'qop', '1500', '2475000', '1500', 30),
  pu('p2', 1, 1, '12000', 'dona', '12000', '15600000', '11400', 40, { alert_types: ['xarid_qabul_farqi'] }),
  pu('p3', 0, 4, '1.2', 't', '1200', '13440000', '0', 2),
  pu('p4', 2, 2, '6', 'm³', '6', '1500000', '6', 60, { alert_types: ['narx_ogishi', 'ozi_qabul_qilgan'], supplier_name: null }),
  pu('p5', 1, 6, '40', 'm²', '40', '4800000', '0', 70),
]

function PurchasesPreview() {
  const [form, setForm] = useState<PurchaseFilterForm>({ objectId: '', materialId: '', buyerId: '', from: '', to: '', includeDeleted: false })
  return (
    <PurchasesView
      rows={purchases}
      total={purchases.length}
      page={0}
      onPage={() => undefined}
      form={form}
      onFilter={(patch) => setForm((f) => ({ ...f, ...patch }))}
      objects={previewObjects}
      materials={previewMaterials}
      profiles={profiles}
      canDelete
      canSeeDeleted
      thresholdPct="2"
      nowIso={new Date().toISOString()}
      onOpen={() => undefined}
      onDelete={() => undefined}
      onRestore={() => undefined}
      exportSlot={<Button variant="secondary">{t.excel.button}</Button>}
    />
  )
}

function al(
  id: string,
  type: AlertType,
  severity: AlertSeverity,
  status: AlertStatus,
  objectIdx: 0 | 1 | 2 | null,
  matIdx: number | null,
  details: Record<string, unknown>,
  h: number,
  extra: Partial<Alert> = {},
): Alert {
  const o = objectIdx === null ? null : previewObjects[objectIdx]!
  const m = matIdx === null ? null : mat(matIdx)
  return {
    id,
    company_id: PREVIEW_COMPANY,
    type,
    status,
    severity,
    object_id: o?.id ?? null,
    material_id: m?.id ?? null,
    purchase_id: null,
    movement_id: null,
    details,
    closed_by: null,
    closed_at: null,
    close_note: null,
    created_at: hoursAgo(h),
    deleted_at: null,
    object_name: o?.name ?? null,
    material_name: m?.name ?? null,
    base_unit: m?.base_unit ?? null,
    ...extra,
  }
}

const alerts: Alert[] = [
  al('a1', 'xarid_qabul_farqi', 'jiddiy', 'yangi', 1, 1, { purchased_qty_base: '12000', received_qty_base: '11400', diff_pct: '5', threshold_pct: '2', direction: 'under' }, 2),
  al('a2', 'narx_ogishi', 'ogohlantirish', 'yangi', 2, 2, { avg: '220000', price: '250000', diff_pct: '13.64', window: 5 }, 5),
  al('a3', 'normadan_oshish', 'jiddiy', 'korildi', 0, 0, { allowed_qty_base: '12000', consumed_qty_base: '13250', over_pct: '10.42', base_unit: 'kg' }, 20),
  al('a4', 'ozi_qabul_qilgan', 'belgi', 'korildi', 2, 2, {}, 30),
  al('a5', 'otkazma_farqi', 'ogohlantirish', 'yopildi', 0, 0, { sent_qty_base: '500', received_qty_base: '450', diff_qty_base: '-50', direction: 'under', base_unit: 'kg', from_object_name: o3.name, to_object_name: o1.name }, 60, {
    close_note: 'Bir qop yirtilgan, dalolatnoma tuzildi',
    closed_at: hoursAgo(50),
  }),
]

function AlertsPreview() {
  const [form, setForm] = useState<AlertFilterForm>({ status: 'open', type: '', severity: '', objectId: '' })
  return (
    <AlertsView
      rows={alerts}
      total={alerts.length}
      page={0}
      onPage={() => undefined}
      form={form}
      onFilter={(patch) => setForm((f) => ({ ...f, ...patch }))}
      objects={[o1, o2, o3]}
      canManage
      onMarkSeen={() => undefined}
      onClose={() => undefined}
      exportSlot={<Button variant="secondary">{t.excel.button}</Button>}
    />
  )
}

export const views: PreviewView[] = [
  { id: 'web-movements', title: 'Ombor — Harakatlar', surface: 'web', role: 'admin', render: () => <MovementsPreview /> },
  { id: 'web-purchases', title: 'Xaridlar', surface: 'web', role: 'admin', render: () => <PurchasesPreview /> },
  { id: 'web-alerts', title: 'Ogohlantirishlar', surface: 'web', role: 'admin', render: () => <AlertsPreview /> },
]
