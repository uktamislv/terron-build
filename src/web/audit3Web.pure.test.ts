// Audit 3 — veb sof funksiyalari: qabul holati "covered", Excel ustunlari (manba, xarajat turi, pul manbai,
// "Smetaga kirmaydi"), faol firmani tanlash.
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { resolveActiveCompany } from '@/auth/activeCompany'
import { Wordmark } from '@/components/ui'
import type { CashHistoryEntry } from '@/data/cashRepo'
import type { Purchase } from '@/data/types'
import { t } from '@/i18n'
import { makeMaterial } from '@/test/fixtures'
import { cashSheets, materialsSheets, purchasesSheet } from './exports'
import { RECEIPT_TONE, receiptState } from './purchases/receiptStatus'

const NOW = '2026-11-10T12:00:00Z'
const OLD = '2026-11-08T05:00:00Z'

function p(received: string, unlinked?: string, extra: Partial<Purchase> = {}) {
  return {
    qty_base: '100',
    purchased_at: OLD,
    receipt: {
      received_qty_base: received,
      remaining_qty_base: String(100 - Number(received)),
      receipt_count: 0,
      last_received_at: null,
      ...(unlinked !== undefined ? { unlinked_qty_base: unlinked } : {}),
    },
    ...extra,
  }
}

describe('receiptState — qoida 1 "covered"', () => {
  it('kam, lekin bog‘lanmagan kirim chegara ichida qoplaydi — covered (sariq)', () => {
    expect(receiptState(p('0', '99'), '2', NOW)).toBe('covered')
    expect(receiptState(p('60', '40'), '2', NOW)).toBe('covered')
    expect(RECEIPT_TONE.covered).toBe('warn')
    expect(t.purchases.receiptStatus.covered).toBeTruthy()
  })

  it('qoplamasa yoki nomzod yo‘q — eskicha (none / under)', () => {
    expect(receiptState(p('0', '50'), '2', NOW)).toBe('none')
    expect(receiptState(p('0', '0'), '2', NOW)).toBe('none')
    expect(receiptState(p('0'), '2', NOW)).toBe('none')
    expect(receiptState(p('60', '10'), '2', NOW)).toBe('under')
  })

  it('24 soat o‘tmagan — pending (nomzoddan qat’i nazar); orqa sana bilan kiritilgan — created_at dan', () => {
    expect(receiptState(p('0', '100', { purchased_at: '2026-11-10T06:00:00Z' }), '2', NOW)).toBe('pending')
    // Xarid sanasi eski, lekin kecha kiritilgan — hali kutilmoqda
    expect(receiptState({ ...p('0'), created_at: '2026-11-10T00:00:00Z' }, '2', NOW)).toBe('pending')
  })
})

describe('Excel', () => {
  it('xaridlar: "Pul manbai" ustuni', () => {
    const sheet = purchasesSheet([{ payment_source: 'firma', unit_input: 'qop', unit_variant: null } as Purchase])
    expect(sheet.columns.map((c) => c.header)).toContain(t.excel.cols.paymentSource)
    expect(sheet.rows[0]?.payment_source).toBe(t.purchases.paymentSources.firma)
  })

  it('materiallar: "Smetaga kirmaydi" ustuni', () => {
    const [cat] = materialsSheets([makeMaterial('m1', 'Mix', 'kg', { outside_estimate: true })])
    expect(cat?.columns.map((c) => c.header)).toContain(t.excel.cols.outsideEstimate)
    expect(cat?.rows[0]?.outside_estimate).toBe(t.common.yes)
  })

  it('podotchet tarixi: manba (Xarid/Xarajat), xarajat turi alohida, obyektsiz xarajat — "Umumiy"', () => {
    const base = { profileId: 'p', profileName: 'Ali', amount: '1', at: OLD, note: null, objectName: null, deletedAt: null }
    const history: CashHistoryEntry[] = [
      { ...base, kind: 'spent', source: 'expense', id: 'e1', materialName: 'Oziq-ovqat' },
      { ...base, kind: 'spent', source: 'purchase', id: 's1', materialName: 'Sement', objectName: 'Obyekt A' },
      { ...base, kind: 'issued', id: 'a1', createdByName: null },
    ]
    const [, sheet] = cashSheets([], history)
    const headers = sheet?.columns.map((c) => c.header)
    expect(headers).toContain(t.excel.cols.source)
    expect(headers).toContain(t.excel.cols.expenseCategory)
    const [expense, purchase, issued] = sheet?.rows ?? []
    expect(expense).toMatchObject({
      kind: t.excel.cashKinds.spentExpense,
      source: t.excel.sources.expense,
      material: null,
      category: 'Oziq-ovqat',
      object: t.expenses.general,
    })
    expect(purchase).toMatchObject({ kind: t.excel.cashKinds.spent, source: t.excel.sources.purchase, material: 'Sement', category: null, object: 'Obyekt A' })
    expect(issued).toMatchObject({ kind: t.excel.cashKinds.issued, source: null })
  })
})

describe('resolveActiveCompany', () => {
  const list = [{ id: 'a', name: 'A', is_active: true, created_at: OLD }]
  it('saqlangan yo‘q — o‘z firmasi; ro‘yxatda bor — o‘sha; ro‘yxatda yo‘q — o‘z firmasi; ro‘yxat yuklanmagan — saqlangan', () => {
    expect(resolveActiveCompany(null, 'own', list)).toBe('own')
    expect(resolveActiveCompany('a', 'own', list)).toBe('a')
    expect(resolveActiveCompany('zz', 'own', list)).toBe('own')
    expect(resolveActiveCompany('zz', 'own', null)).toBe('zz')
  })
})

describe('Wordmark', () => {
  it('BUILD kamida 11 px; navy fonda nuqta och ko‘k', () => {
    const { container } = render(createElement(Wordmark, { onDark: true }))
    const spans = container.querySelectorAll('span[aria-hidden]')
    expect(spans[0]?.className).toContain('bg-brand-300')
    expect(spans[1]?.className).toContain('max(0.38em,11px)')
    const light = render(createElement(Wordmark)).container.querySelectorAll('span[aria-hidden]')
    expect(light[0]?.className).toContain('bg-brand')
    expect(light[0]?.className).not.toContain('bg-brand-300')
  })
})
