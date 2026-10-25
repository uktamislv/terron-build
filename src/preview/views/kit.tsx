/* eslint-disable react-refresh/only-export-components -- ko‘rgazma fayli: ekran ro‘yxati va komponentlar birga */
// UI to'plami ko'rgazmasi (?view=kit) — komponentlarni bir joyda ko'rish uchun.
import { useState } from 'react'
import { Download, Package, Plus, TriangleAlert, Wallet, Warehouse } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  EntryRow,
  FilterBar,
  LevelBar,
  Money,
  Notice,
  PageHeader,
  Qty,
  SegmentedControl,
  SkeletonRows,
  StatTile,
  Tabs,
  useToast,
} from '@/components/ui'
import { previewObjects } from '../fixtures'
import type { PreviewView } from '../types'

interface Row {
  id: string
  kind: 'kirim' | 'chiqim'
  material: string
  object: string
  qty: string
  unit: string
}

const rows: Row[] = [
  { id: '1', kind: 'kirim', material: 'Sement M400', object: 'Chilonzor 12-uy', qty: '1500', unit: 'kg' },
  { id: '2', kind: 'chiqim', material: 'Armatura Ø12', object: 'Yunusobod maktab', qty: '1200.5', unit: 'kg' },
  { id: '3', kind: 'kirim', material: 'G‘isht (pishiq)', object: 'Chilonzor 12-uy', qty: '12000', unit: 'dona' },
]

function Kit() {
  const [object, setObject] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [deleted, setDeleted] = useState(false)
  const [seg, setSeg] = useState<'kirim' | 'chiqim'>('kirim')
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  const toast = useToast()
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Ombor"
        icon={<Warehouse strokeWidth={1.75} />}
        actions={
          <>
            <Button variant="secondary" icon={<Download aria-hidden className="size-5" strokeWidth={1.75} />}>
              Excel
            </Button>
            <Button icon={<Plus aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => toast.show('Saqlandi')}>
              Qo‘shish
            </Button>
          </>
        }
      />
      <Tabs
        label="Ombor"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'a', label: 'Harakatlar' },
          { key: 'b', label: 'Qoldiq' },
          { key: 'c', label: 'O‘tkazmalar', count: 2 },
        ]}
      />
      <FilterBar
        onClear={() => {
          setObject('')
          setType('')
          setFrom('')
          setTo('')
          setDeleted(false)
        }}
        filters={[
          {
            kind: 'select',
            key: 'o',
            label: 'Obyekt',
            value: object,
            onChange: setObject,
            options: [{ value: '', label: 'Hammasi' }, ...previewObjects.map((o) => ({ value: o.id, label: o.name }))],
          },
          { kind: 'dateRange', key: 'd', label: 'Sana', from, to, onFrom: setFrom, onTo: setTo, fromLabel: 'Boshlanish', toLabel: 'Tugash' },
          {
            kind: 'select',
            key: 't',
            label: 'Tur',
            value: type,
            onChange: setType,
            options: [
              { value: '', label: 'Hammasi' },
              { value: 'kirim', label: 'Kirim' },
              { value: 'chiqim', label: 'Chiqim' },
            ],
          },
          { kind: 'toggle', key: 'del', label: 'O‘chirilganlar', checked: deleted, onChange: setDeleted },
        ]}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Package />} label="Kirim (7 kun)" value={<Qty value="12450" unit="kg" size="lg" />} hint="32 ta yozuv" to="#" />
        <StatTile icon={<Wallet />} label="Xaridlar" value={<Money value="48250000" size="lg" />} to="#" />
        <StatTile icon={<TriangleAlert />} label="Yangi farqlar" value="3" tone="danger" live />
        <StatTile icon={<Warehouse />} label="Obyektlar" value="3" live />
      </div>
      <DataTable
        caption="Harakatlar"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'date', header: 'Sana', cell: () => <span className="tabular">25.10.2026 14:32</span> },
          { key: 'type', header: 'Tur', cell: (r) => <Badge tone={r.kind === 'kirim' ? 'ok' : 'info'}>{r.kind === 'kirim' ? 'Kirim' : 'Chiqim'}</Badge> },
          { key: 'obj', header: 'Obyekt', cell: (r) => r.object },
          { key: 'mat', header: 'Material', cell: (r) => <span className="font-medium">{r.material}</span> },
          { key: 'qty', header: 'Miqdor', align: 'right', cell: (r) => <Qty value={r.qty} unit={r.unit} /> },
        ]}
        renderMobile={(r) => (
          <EntryRow kind={r.kind} title={r.material} meta={<><span>{r.object}</span><span>bugun 14:32</span></>} trailing={<Qty value={r.qty} unit={r.unit} />} />
        )}
      />
      <Card title="Smeta ishlatilishi">
        <div className="flex flex-col gap-4">
          {[
            ['Sement M400', 62, 100],
            ['Armatura Ø12', 93, 100],
            ['G‘isht', 128, 100],
          ].map(([n, v, m]) => (
            <div key={n as string} className="flex flex-col gap-1">
              <span className="text-sm font-medium">{n}</span>
              <LevelBar label={n as string} value={v as number} max={m as number} />
            </div>
          ))}
        </div>
      </Card>
      <SegmentedControl
        label="Tur"
        value={seg}
        onChange={setSeg}
        size="lg"
        options={[
          { value: 'kirim', label: 'Kirim', tone: 'ok' },
          { value: 'chiqim', label: 'Chiqim', tone: 'brand' },
        ]}
      />
      <div className="flex flex-col items-start gap-2">
        <Qty value="150" unit="kg" size="hero" />
        <Money value="-1250000" size="lg" />
      </div>
      <Notice tone="warn">Narx o‘rtachadan 12 % yuqori.</Notice>
      <EmptyState title="Hali kirim yo‘q" text="Birinchi kirimni Telegram’dan kiriting." action={<Button variant="secondary">Yo‘riqnoma</Button>} />
      <SkeletonRows rows={2} />
    </div>
  )
}

export const views: PreviewView[] = [{ id: 'kit', title: 'UI to‘plami', surface: 'web', role: 'admin', render: () => <Kit /> }]
