// Audit 2 (UI/UX) — komponentlar: varaq va Telegram tugmalari, Checkbox, maydon qo'shimchasi/xatosi,
// sana oralig'i xatosi, material qidiruvi, pul tarixi qatori, Excel tugmasi, bo'limlar belgisi.
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CashHistoryRow } from '@/components/CashHistoryRow'
import { BottomSheet, Checkbox, FilterBar, SelectField, SheetChromeContext, TextField, ToastProvider } from '@/components/ui'
import type { CashHistoryEntry } from '@/data/cashRepo'
import { RepoError } from '@/data/errors'
import { normalizeSummary } from '@/data/reportsRepo'
import { t } from '@/i18n'
import { formatSum } from '@/lib/format'
import { makeMaterial } from '@/test/fixtures'
import { HomeSectionsView } from '@/tg/home/HomeSections'
import { registerSheet, useBackButton, useMainButton } from '@/tg/useTelegramButtons'
import { buildCards } from '@/web/dashboard/cards'
import { alertDetailText } from '@/web/alerts/alertDetails'
import { ExportButton } from '@/web/ExportButton'
import { MaterialPicker } from '@/web/purchases/MaterialPicker'
import { loadLastPurchaseObject, saveLastPurchaseObject } from '@/web/purchases/lastObject'

const tg = vi.hoisted(() => ({
  main: { show: vi.fn<(...a: unknown[]) => void>(), hide: vi.fn<(...a: unknown[]) => void>() },
  backHandlers: [] as (() => void)[],
  back: { show: vi.fn<(...a: unknown[]) => void>(), hide: vi.fn<(...a: unknown[]) => void>() },
}))

vi.mock('@/tg/telegram', () => {
  const main: Record<string, unknown> = {}
  const chain = () => main
  const app = {
    MainButton: Object.assign(main, {
      setText: vi.fn(chain),
      onClick: vi.fn(chain),
      offClick: vi.fn(chain),
      enable: vi.fn(chain),
      disable: vi.fn(chain),
      showProgress: vi.fn(chain),
      hideProgress: vi.fn(chain),
      setParams: vi.fn(chain),
      show: (...a: unknown[]) => tg.main.show(...a),
      hide: (...a: unknown[]) => tg.main.hide(...a),
    }),
    BackButton: {
      show: (...a: unknown[]) => tg.back.show(...a),
      hide: (...a: unknown[]) => tg.back.hide(...a),
      onClick: (cb: () => void) => tg.backHandlers.push(cb),
      offClick: (cb: () => void) => {
        tg.backHandlers = tg.backHandlers.filter((h) => h !== cb)
      },
    },
  }
  return { getWebApp: () => app, haptic: { tap: vi.fn(), select: vi.fn(), success: vi.fn(), error: vi.fn() } }
})

describe('1: BottomSheet — Telegram MainButton va BackButton', () => {
  function Harness({ onPageBack }: { onPageBack: () => void }) {
    const [open, setOpen] = useState(false)
    useMainButton('Saqlash', () => undefined)
    useBackButton(onPageBack)
    return (
      <SheetChromeContext.Provider value={registerSheet}>
        <button type="button" onClick={() => setOpen(true)}>
          ochish
        </button>
        {open && (
          <BottomSheet title="Varaq" onClose={() => setOpen(false)}>
            <p>ichi</p>
          </BottomSheet>
        )}
      </SheetChromeContext.Provider>
    )
  }

  it('ochiq varaqda MainButton yashirin, BackButton faqat varaqni yopadi; yopilgach MainButton qaytadi', async () => {
    const onPageBack = vi.fn()
    render(<Harness onPageBack={onPageBack} />)
    expect(tg.main.show).toHaveBeenCalled()
    tg.main.hide.mockClear()
    tg.main.show.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'ochish' }))
    const sheet = await screen.findByRole('dialog', { name: 'Varaq' })
    // Sarlavha — text-lg; pastki bo'shliq — safe-area
    expect(within(sheet).getByRole('heading', { name: 'Varaq' })).toHaveClass('text-lg')
    expect(within(sheet).getByText('ichi').parentElement?.className).toContain('safe-area-inset-bottom')
    expect(tg.main.hide).toHaveBeenCalled()
    // Telegram "orqaga" — varaq yopiladi, sahifa orqaga ketmaydi
    act(() => tg.backHandlers.at(-1)?.())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Varaq' })).not.toBeInTheDocument())
    expect(onPageBack).not.toHaveBeenCalled()
    expect(tg.main.show).toHaveBeenCalled()
    // Varaq yo'q — endi sahifaning "orqaga" amali
    act(() => tg.backHandlers.at(-1)?.())
    expect(onPageBack).toHaveBeenCalledTimes(1)
  })
})

describe('round-1: Checkbox', () => {
  it('native input (klaviatura, label) — line-strong chegara, belgilanganda brand', () => {
    const onChange = vi.fn()
    render(
      <label>
        <Checkbox checked={false} onChange={onChange} />
        Tinch soatlar
      </label>,
    )
    const box = screen.getByRole('checkbox', { name: 'Tinch soatlar' })
    expect(box).toHaveClass('border-line-strong', 'checked:bg-brand')
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalled()
  })
})

describe('13: TextField qo‘shimchasi va SelectField xatosi', () => {
  it('"so‘m" maydon ichida, aria-describedby orqali; yorliq o‘zgarmaydi', () => {
    render(<TextField label="Jami summa" suffix={t.ui.sum} value="" onChange={() => undefined} />)
    const input = screen.getByLabelText('Jami summa')
    const suffix = screen.getByText(t.ui.sum)
    expect(input.getAttribute('aria-describedby')).toContain(suffix.id)
  })

  it('SelectField xatosi: qizil chegara, aria-invalid, role=alert matn', () => {
    render(
      <SelectField label="Obyekt" value="" onChange={() => undefined} error="Obyektni tanlang.">
        <option value="">—</option>
      </SelectField>,
    )
    const select = screen.getByLabelText('Obyekt')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select.className).toContain('border-danger')
    expect(screen.getByRole('alert')).toHaveTextContent('Obyektni tanlang.')
    expect(select.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })
})

describe('round-1: FilterBar sana oralig‘i — noto‘g‘ri sana ko‘rsatiladi', () => {
  it('mavjud bo‘lmagan sana — chip qizil, xato matni', () => {
    render(
      <FilterBar
        filters={[{ kind: 'dateRange', key: 'd', label: 'Sana', from: '', to: '', onFrom: () => undefined, onTo: () => undefined, fromLabel: 'Dan', toLabel: 'Gacha' }]}
      />,
    )
    const from = screen.getByLabelText('Dan')
    fireEvent.change(from, { target: { value: '31.02.2026' } })
    expect(from).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(t.ui.dateInvalid)
    expect(screen.getByRole('group', { name: 'Sana' }).className).toContain('border-danger')
  })
})

describe('23: MaterialPicker', () => {
  const materials = Array.from({ length: 10 }, (_, i) => makeMaterial(`m${i}`, `Material ${i}`, 'kg'))

  it('8 tadan ko‘p — "Yana N ta — qidiruvni aniqlashtiring"', () => {
    render(<MaterialPicker materials={materials} value={null} onChange={() => undefined} />)
    expect(screen.getByTestId('material-more')).toHaveTextContent(t.purchases.addForm.moreResults(2))
  })

  it('"O‘zgartirish" — qidiruv maydoni darhol fokusda', () => {
    render(<MaterialPicker materials={materials} value="m1" onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: t.tg.movement.change }))
    expect(screen.getByRole('searchbox', { name: t.tg.movement.search })).toHaveFocus()
  })
})

describe('18: pul tarixi qatori — veb va Telegram ilovasida bir xil', () => {
  const issued: CashHistoryEntry = { kind: 'issued', id: 'a', profileId: 'p', profileName: 'Ali', amount: '1000', at: '2026-10-26T05:00:00Z', note: null, createdByName: 'Buxgalter', deletedAt: null }
  const returned: CashHistoryEntry = { ...issued, id: 'b', kind: 'returned' }

  it.each(['person', 'self'] as const)('%s: berildi "+" yashil, qaytarildi "−"; qaytarishda "Kiritgan: X"', (perspective) => {
    const { unmount } = render(
      <ul>
        <CashHistoryRow entry={issued} perspective={perspective} />
        <CashHistoryRow entry={returned} perspective={perspective} />
      </ul>,
    )
    const [plus, minus] = document.querySelectorAll('[data-sign]')
    expect(plus).toHaveAttribute('data-sign', 'plus')
    expect(plus?.className).toContain('text-ok')
    expect(minus).toHaveAttribute('data-sign', 'minus')
    expect(screen.getByText(t.cash.givenBy('Buxgalter'))).toBeInTheDocument()
    expect(screen.getByText(t.cash.enteredBy('Buxgalter'))).toBeInTheDocument()
    unmount()
  })
})

describe('19: ExportButton', () => {
  it('jarayonda — kenglik o‘zgarmaydi, spinner tugma ichida, bekor qilish belgisi; xato — Toast', async () => {
    let fail: (e: unknown) => void = () => undefined
    render(
      <ToastProvider>
        <ExportButton run={() => new Promise((_r, reject) => (fail = reject))} />
      </ToastProvider>,
    )
    const button = screen.getByRole('button', { name: t.excel.button })
    expect(button).toHaveClass('w-32')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByRole('button', { name: t.excel.cancel })).toBeInTheDocument()
    await act(async () => fail(new RepoError('export_too_large')))
    expect(await screen.findByText(t.errors.export_too_large)).toBeInTheDocument()
  })
})

describe('2: "Bo‘limlar" — kutayotganlar soni', () => {
  it('"So‘rovlarni tasdiqlash" plitkasida son va ekran o‘quvchi matni', () => {
    render(
      <MemoryRouter>
        <HomeSectionsView
          links={[
            { key: 'approvals', to: '/tg/approvals', label: t.tg.approvals.title },
            { key: 'stock', to: '/tg/stock', label: t.tg.stock.title },
          ]}
          pending={4}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('section-approvals')).toHaveTextContent(`4 ${t.tg.sections.pending}`)
    expect(screen.getByTestId('section-stock')).not.toHaveTextContent(t.tg.sections.pending)
  })
})

describe('D: veb "Xarid qo‘shish" — oxirgi obyekt', () => {
  it('saqlanadi va o‘qiladi; localStorage yopiq bo‘lsa — xato emas', () => {
    window.localStorage.clear()
    expect(loadLastPurchaseObject()).toBeNull()
    saveLastPurchaseObject('o-1')
    expect(loadLastPurchaseObject()).toBe('o-1')
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadLastPurchaseObject()).toBeNull()
    spy.mockRestore()
  })
})

describe('dashboard_summary — yangi kalitlar', () => {
  it('telegram_blocked_count (admin/direktor kartochkasi), xodimlarga qarz, telegram_me_blocked', () => {
    const s = normalizeSummary({ telegram_blocked_count: 2, telegram_me_blocked: true, cash_owed_to_staff_sum: '50000', cash_on_hand_total: '100' })
    expect(s.telegram_me_blocked).toBe(true)
    const admin = buildCards(s, 'admin', { from: '2026-10-01', to: '2026-10-07', objectId: '' })
    expect(admin.find((c) => c.key === 'telegramBlocked')).toMatchObject({ tone: 'warn', to: '/settings?tab=telegram' })
    expect(admin.find((c) => c.key === 'cashOnHand')?.sub).toContain('Xodimlarga qarz')
    expect(buildCards(s, 'buxgalter', { from: '2026-10-01', to: '2026-10-07', objectId: '' }).some((c) => c.key === 'telegramBlocked')).toBe(false)
  })
})

describe('yangi alert turlari va tafsilotlar', () => {
  const text = (type: string, details: Record<string, unknown>) =>
    alertDetailText({ type, details, base_unit: 'kg' } as Parameters<typeof alertDetailText>[0])

  it('xarid_boshqa_nomidan, sotuvchi_birlashtirildi — nom va matn', () => {
    expect(t.alertTexts.types.xarid_boshqa_nomidan).toBeTruthy()
    expect(text('xarid_boshqa_nomidan', { actor_name: 'Admin', buyer_name: 'Ali', material_name: 'Sement', amount: '100000', payment_source: 'firma' })).toBe(
      `Admin Ali nomidan xarid kiritdi: Sement, ${formatSum('100000')} (${t.alertsPage.details.purchaseOnBehalfFirma})`,
    )
    expect(text('sotuvchi_birlashtirildi', { merged_name: 'Bozor (eski)', keep_name: 'Bozor', moved_count: 3, actor_name: 'Admin' })).toBe(
      '“Bozor (eski)” “Bozor”ga birlashtirildi: 3 ta xarid ko‘chirildi — Admin',
    )
  })

  it('yozuv_tuzatildi: bekor qilish (via cancel_own_entry) va sabab; login — birinchi marta; manfiy qoldiq — qayta', () => {
    expect(text('yozuv_tuzatildi', { table: 'movements', movement_type: 'kirim', via: 'cancel_own_entry', reason: 'ikki marta', material_name: 'Sement', actor_name: 'Ali' })).toBe(
      'Ali o‘z kirimini bekor qildi: Sement — sabab: ikki marta',
    )
    expect(text('login_ozgardi', { target_name: 'Vali', target_role: 'direktor', actor_name: 'Admin', first_login: true })).toContain('birinchi marta')
    expect(text('manfiy_qoldiq', { stock_after: '-5', qty_base: '10', unit: 'kg', movement_type: 'chiqim', reopen_count: 2, reopened_at: '2026-10-26T05:00:00Z' })).toContain(
      'qayta manfiy bo‘ldi: 2-marta, 26.10.2026 10:00',
    )
  })
})
