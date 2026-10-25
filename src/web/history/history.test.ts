import { emptyRefNames, type AuditEntry } from '@/data/historyRepo'
import { alertDetailText } from '../alerts/alertDetails'
import { t } from '@/i18n'
import { changesText, collectRefIds, entryRecordDate, formatValue, isPastPeriod, isRestorable, isTransferMovement, localizeLabel, restoredLater } from './historyFormat'
import { historyHref, historySearch, readHistoryQuery } from './historyQuery'

const ID = '5b0e6f0a-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
const today = '2026-10-25'

describe('historyQuery', () => {
  it('URL → filtr → URL (aylanma)', () => {
    const q = readHistoryQuery(new URLSearchParams(`from=2026-10-01&to=2026-10-20&table=purchases&action=UPDATE&actor=${ID}&device=mobil`), today)
    expect(q).toMatchObject({ tab: 'feed', from: '2026-10-01', to: '2026-10-20', table: 'purchases', action: 'UPDATE', actorId: ID, device: 'mobil', recordId: '' })
    expect(historySearch(q).toString()).toBe(`from=2026-10-01&to=2026-10-20&table=purchases&action=UPDATE&actor=${ID}&device=mobil`)
  })

  it('O‘chirilganlar tabida faqat davr va jadval yoziladi', () => {
    const q = readHistoryQuery(new URLSearchParams(`tab=deleted&table=auth&action=UPDATE&record=${ID}`), today)
    expect(historySearch(q).toString()).toBe(`tab=deleted&from=${q.from}&to=${q.to}&table=auth`)
  })

  it('davr noto‘g‘ri — standart 7 kun va belgi', () => {
    const q = readHistoryQuery(new URLSearchParams('from=2026-10-20&to=2026-10-01'), today)
    expect(q).toMatchObject({ from: '2026-10-19', to: today, invalid: 'reversed' })
  })

  it('havola', () => {
    expect(historyHref('movements', ID)).toBe(`/history?record=${ID}&table=movements`)
    expect(historyHref(null, ID)).toBe(`/history?record=${ID}`)
  })
})

describe('historyFormat', () => {
  const names = { ...emptyRefNames(), objects: { [ID]: 'Obyekt A' } }

  it('qiymatlar turiga qarab', () => {
    expect(formatValue('purchases', 'total_amount', '1250000.00', names)).toBe('1 250 000 so‘m')
    expect(formatValue('movements', 'qty_base', '1500.500000', names)).toBe('1 500,5')
    expect(formatValue('movements', 'object_id', ID, names)).toBe('Obyekt A')
    expect(formatValue('movements', 'material_id', ID, names)).toBe('—')
    expect(formatValue('movements', 'type', 'kirim', names)).toBe(t.movements.types.kirim)
    expect(formatValue('materials', 'is_active', false, names)).toBe(t.common.no)
    expect(formatValue('movements', 'occurred_at', '2026-10-25T05:00:00Z', names)).toBe('25.10.2026 10:00')
    expect(formatValue('material_requests', 'needed_by', '2026-10-30', names)).toBe('30.10.2026')
    expect(formatValue('movements', 'transfer_id', ID, names)).toBe('5b0e6f0a…')
    expect(formatValue('movements', 'note', null, names)).toBe('—')
  })

  it('bog‘langan id’lar takrorsiz yig‘iladi', () => {
    const ids = collectRefIds([
      { table: 'movements', changes: [{ field: 'object_id', before: ID, after: ID }, { field: 'note', before: 'a', after: 'b' }] },
      { table: 'transfers', changes: [{ field: 'to_object_id', before: null, after: ID }] },
    ])
    expect(ids.objects).toEqual([ID])
    expect(ids.materials).toEqual([])
  })

  it('Excel matni', () => {
    expect(changesText('purchases', [{ field: 'total_amount', before: '1', after: '2' }, { field: 'note', before: null, after: 'x' }], names)).toBe(
      `${t.history.fields.total_amount}: 1 so‘m → 2 so‘m; ${t.history.fields.note}: x`,
    )
  })

  it('tiklanadigan jadvallar', () => {
    expect(isRestorable('purchases')).toBe(true)
    expect(isRestorable('transfers')).toBe(false)
    expect(isRestorable('companies')).toBe(false)
    expect(isRestorable('alerts')).toBe(false)
  })
})

describe('review: tiklash yordamchilari', () => {
  it('o‘tgan davr — joriy oydan oldin (Toshkent)', () => {
    expect(isPastPeriod('2026-09-30T18:59:00Z', '2026-10-25')).toBe(true)
    // 30.09 19:00 UTC = 01.10 00:00 Toshkent — joriy oy
    expect(isPastPeriod('2026-09-30T19:00:00Z', '2026-10-25')).toBe(false)
    expect(isPastPeriod('x', '2026-10-25')).toBe(false)
  })

  it('o‘tkazma harakati va keyinroq tiklangan', () => {
    const base = { table_name: 'movements', old_data: null, new_data: { transfer_id: ID } }
    expect(isTransferMovement(base)).toBe(true)
    expect(isTransferMovement({ ...base, new_data: { transfer_id: null } })).toBe(false)
    const del = { id: 5, table_name: 'movements', record_id: ID }
    const restore = { id: 9, table_name: 'movements', record_id: ID, action: 'RESTORE' } as AuditEntry
    expect(restoredLater(del, [restore])).toBe(true)
    expect(restoredLater({ ...del, id: 10 }, [restore])).toBe(false)
  })

  it('alert nomidagi xom tur', () => {
    expect(localizeLabel('alerts', 'narx_ogishi · Sement')).toBe(`${t.alertTexts.types.narx_ogishi} · Sement`)
    expect(localizeLabel('movements', 'narx_ogishi')).toBe('narx_ogishi')
    expect(entryRecordDate({ table_name: 'purchases', old_data: null, new_data: { purchased_at: '2026-01-01' } })).toBe('2026-01-01')
    expect(entryRecordDate({ table_name: 'materials', old_data: null, new_data: { purchased_at: 'x' } })).toBeNull()
  })

  it('yozuv_tiklandi alert matni', () => {
    const text = alertDetailText({
      type: 'yozuv_tiklandi',
      base_unit: null,
      details: { table: 'movements', movement_type: 'kirim', material_name: 'Sement', qty_base: '1500', base_unit: 'kg', occurred_at: '2026-09-01T05:00:00Z', days_since: 12, actor_name: 'Ali' },
    })
    expect(text).toBe(`Kirim tiklandi: Sement · 1 500 kg · ${t.alertsPage.details.restoredDate('01.09.2026')} · ${t.alertsPage.details.restoredAfter('12')} (Ali)`)
    expect(alertDetailText({ type: 'yozuv_tiklandi', base_unit: null, details: { table: 'cash_advances', recipient_name: 'Vali', amount: '500000' } })).toBe(
      'Berilgan pul tiklandi: Vali · 500 000 so‘m',
    )
  })
})
