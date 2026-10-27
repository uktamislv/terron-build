import { render, screen } from '@testing-library/react'
import type { CashHistoryEntry } from '@/data/cashRepo'
import { t } from '@/i18n'
import { CashHistoryRow } from './CashHistoryRow'

const spent: CashHistoryEntry = {
  kind: 'spent',
  source: 'expense',
  id: 'e1',
  profileId: 'p',
  profileName: 'Ali',
  amount: '41000',
  at: '2026-11-02T05:00:00Z',
  note: null,
  materialName: 'Oziq-ovqat',
  objectName: null,
  deletedAt: null,
}

describe('CashHistoryRow — xarajat "sarflandi" qatori', () => {
  it('o‘z puli: sarlavha — tur, obyektsiz — "Umumiy", minus bilan', () => {
    render(
      <ul>
        <CashHistoryRow entry={spent} perspective="self" />
      </ul>,
    )
    expect(screen.getByText('Oziq-ovqat')).toBeInTheDocument()
    expect(screen.getByText(t.expenses.general)).toBeInTheDocument()
    expect(document.querySelector('[data-sign="minus"]')).not.toBeNull()
  })

  it('veb (odam bo‘yicha): belgi "Xarajat", tur va obyekt', () => {
    render(
      <ul>
        <CashHistoryRow entry={{ ...spent, objectName: 'Obyekt A' }} perspective="person" />
      </ul>,
    )
    expect(screen.getByText(t.expenses.cashKind)).toBeInTheDocument()
    expect(screen.getByText('Oziq-ovqat, Obyekt A')).toBeInTheDocument()
  })
})
