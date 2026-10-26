import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { t } from '@/i18n'
import { textOf } from '@/test/text'
import { DataTable } from './DataTable'
import { FilterBar, type FilterDef } from './FilterBar'
import { LevelBar } from './LevelBar'
import { Modal } from './Modal'
import { Money, Qty } from './Qty'
import { SegmentedControl } from './SegmentedControl'
import { Tabs } from './Tabs'

/** `matchMedia` ni telefon (true) yoki kompyuter (false) qilib qo'yish. */
function mockMobile(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile && query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

afterEach(() => {
  // jsdom'da asl holat — matchMedia yo'q (kompyuter ko'rinishi)
  delete (window as { matchMedia?: unknown }).matchMedia
})

function ObjectFilter({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('')
  const filters: FilterDef[] = [
    {
      kind: 'select',
      key: 'object',
      label: 'Obyekt',
      value,
      onChange: (v) => {
        setValue(v)
        onChange(v)
      },
      options: [
        { value: '', label: 'Hammasi' },
        { value: 'a', label: 'Obyekt A' },
        { value: 'b', label: 'Obyekt B' },
      ],
    },
  ]
  return <FilterBar filters={filters} onClear={() => setValue('')} />
}

describe('FilterBar', () => {
  it('kompyuterda — qatordagi select (yorliq bilan), faol bo‘lsa "Tozalash"', () => {
    const onChange = vi.fn()
    render(<ObjectFilter onChange={onChange} />)
    const form = screen.getByRole('form', { name: t.ui.filters })
    expect(within(form).queryByRole('button', { name: /Obyekt/ })).not.toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Obyekt'), { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
    fireEvent.click(within(form).getByRole('button', { name: t.ui.clearFilters }))
    expect(within(form).getByLabelText('Obyekt')).toHaveValue('')
  })

  it('telefonda — chip bosilsa pastki varaq ochiladi, variant tanlanadi va varaq yopiladi', () => {
    mockMobile(true)
    const onChange = vi.fn()
    render(<ObjectFilter onChange={onChange} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Obyekt/ }))
    const sheet = screen.getByRole('dialog', { name: 'Obyekt' })
    expect(within(sheet).getByRole('radio', { name: 'Hammasi' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Obyekt B' }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Obyekt/ })).toHaveTextContent('Obyekt B')
  })

  it('telefonda — varaq Esc bilan yopiladi va fokus chipga qaytadi', () => {
    mockMobile(true)
    render(<ObjectFilter onChange={() => undefined} />)
    const chip = screen.getByRole('button', { name: /Obyekt/ })
    chip.focus()
    fireEvent.click(chip)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
  })
})

interface Row {
  id: string
  name: string
  qty: string
}
const rows: Row[] = [
  { id: '1', name: 'Sement', qty: '150' },
  { id: '2', name: 'Qum', qty: '2.5' },
]

function Table() {
  return (
    <DataTable
      caption="Harakatlar"
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: 'name', header: 'Material', cell: (r) => r.name },
        { key: 'qty', header: 'Miqdor', align: 'right', cell: (r) => <Qty value={r.qty} unit="kg" /> },
      ]}
      renderMobile={(r) => <div data-testid="mobile-row">{r.name}</div>}
    />
  )
}

describe('DataTable', () => {
  it('kompyuterda — jadval, raqam ustuni o‘ngda', () => {
    render(<Table />)
    const table = screen.getByRole('table', { name: 'Harakatlar' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText(textOf('2,5 kg'))).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader')[1]).toHaveClass('text-right')
  })

  it('telefonda — `renderMobile` qatorlari ro‘yxati, jadval yo‘q', () => {
    mockMobile(true)
    render(<Table />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Harakatlar' })
    expect(within(list).getAllByTestId('mobile-row').map((r) => r.textContent)).toEqual(['Sement', 'Qum'])
  })

  it('qator bo‘lmasa — bo‘sh holat', () => {
    render(<DataTable rows={[]} rowKey={(r: Row) => r.id} columns={[]} empty={<p>Bo‘sh</p>} />)
    expect(screen.getByText('Bo‘sh')).toBeInTheDocument()
  })
})

function Segments({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState<'kirim' | 'chiqim'>('kirim')
  return (
    <SegmentedControl
      label="Tur"
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
      options={[
        { value: 'kirim', label: 'Kirim', tone: 'ok' },
        { value: 'chiqim', label: 'Chiqim' },
      ]}
    />
  )
}

describe('SegmentedControl', () => {
  it('tugmalar guruhi: aria-pressed, bitta Tab to‘xtashi', () => {
    render(<Segments onChange={() => undefined} />)
    const group = screen.getByRole('group', { name: 'Tur' })
    const [kirim, chiqim] = within(group).getAllByRole('button')
    expect(kirim).toHaveAttribute('aria-pressed', 'true')
    expect(kirim).toHaveAttribute('tabindex', '0')
    expect(chiqim).toHaveAttribute('tabindex', '-1')
  })

  it('klaviatura: → keyingisini tanlaydi va fokuslaydi, ← / Home qaytaradi, oxiridan aylanadi', () => {
    const onChange = vi.fn()
    render(<Segments onChange={onChange} />)
    const kirim = screen.getByRole('button', { name: 'Kirim' })
    const chiqim = screen.getByRole('button', { name: 'Chiqim' })
    kirim.focus()
    fireEvent.keyDown(kirim, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('chiqim')
    expect(chiqim).toHaveFocus()
    expect(chiqim).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(chiqim, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('kirim')
    expect(kirim).toHaveFocus()
    fireEvent.keyDown(kirim, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('chiqim')
    fireEvent.keyDown(chiqim, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('kirim')
  })
})

describe('Tabs', () => {
  it('role=tab, ←/→ bilan almashadi', () => {
    const onChange = vi.fn()
    render(
      <Tabs
        label="Ombor"
        value="a"
        onChange={onChange}
        items={[
          { key: 'a', label: 'Harakatlar' },
          { key: 'b', label: 'Qoldiq' },
        ]}
      />,
    )
    const tab = screen.getByRole('tab', { name: 'Harakatlar' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Modal', () => {
  it('Tab fokusni dialog ichida aylantiradi, Esc yopadi', () => {
    const onClose = vi.fn()
    render(
      <Modal title="Sinov" onClose={onClose}>
        <button type="button">Birinchi</button>
        <button type="button">Oxirgi</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Sinov' })
    expect(dialog).toHaveFocus()
    const last = screen.getByRole('button', { name: 'Oxirgi' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: t.common.close })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Qty, Money, LevelBar', () => {
  it('Qty: raqam formatlanadi, birlik alohida', () => {
    render(<Qty value="1250.5" unit="kg" tone="danger" />)
    expect(screen.getByText('1 250,5')).toBeInTheDocument()
    expect(screen.getByText('kg')).toBeInTheDocument()
  })

  it('Money: manfiy summa qizil', () => {
    const { container } = render(<Money value="-150000" />)
    expect(container.firstChild).toHaveClass('text-danger')
    expect(container.firstChild).toHaveTextContent('\u2212150 000 so‘m')
  })

  it('LevelBar: normadan oshganda foiz qizil, meter qiymati', () => {
    render(<LevelBar label="Sement" value={130} max={100} />)
    expect(screen.getByRole('meter', { name: 'Sement' })).toHaveAttribute('aria-valuenow', '130')
    expect(screen.getByText('130%')).toHaveClass('text-danger')
  })
})
