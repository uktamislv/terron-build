// Audit tuzatishlari — repo qatlami (docs/audit-fixes.md): profile_directory, correct_entry, sotuvchilar,
// tinch soatlar, notification_health, notify_workflow, podotchet izohi, obyekt alertlari, photo-hash.
import { listSiteAlerts, SITE_ALERT_TYPES } from './alertsRepo'
import { listMyAdvances, updateAdvanceNote } from './cashRepo'
import { getCompanySettings, getNotificationHealth, hhmm, normalizeHealth, updateCompanySettings } from './companiesRepo'
import { correctEntry } from './correctionsRepo'
import { RepoError, SERVER_HINTS, toRepoError } from './errors'
import { requestPhotoHash } from './functions'
import { listCounts } from './inventoryRepo'
import { listMovements } from './movementsRepo'
import { attachNames, directoryNames, listActiveDirectory, listDirectory } from './profileDirectory'
import { setMyNotifyWorkflow } from './profilesRepo'
import { listMyPurchases } from './purchasesRepo'
import { receiptLookup } from './receiptRepo'
import { approveRequest, listRequests } from './requestsRepo'
import { mergeSuppliers, restoreSupplier, softDeleteSupplier, supplierPatchToRow, updateSupplier } from './suppliersRepo'
import { listAllTransfers } from './transfersRepo'
import { t } from '@/i18n'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  results: [] as unknown[],
  people: [] as { id: string; full_name: string; role: string; is_active?: boolean }[],
  invoke: vi.fn(),
}))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args])
          return q
        }
      },
    },
  )
  return q
}

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    from: (table: string) => {
      fake.calls.push(['from', table])
      if (table === 'profile_directory') return fakeQuery(fake.calls, () => ({ data: fake.people, error: null }))
      return fakeQuery(fake.calls, () => fake.results.shift() ?? { data: [], error: null, count: 0 })
    },
    rpc: (fn: string, args: unknown) => {
      fake.calls.push(['rpc', fn, args])
      return Promise.resolve(fake.results.shift() ?? { data: null, error: null })
    },
    functions: { invoke: fake.invoke },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
  fake.people.length = 0
  fake.invoke.mockReset()
})

const arg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]
const callsOf = (method: string) => fake.calls.filter((c) => c[0] === method)

describe('profile_directory (admin bo‘lmaganlar boshqa xodimlar ismini shu yerdan oladi)', () => {
  it('listDirectory: faqat id, firma, ism, rol, faollik; listActiveDirectory — faol va rol bo‘yicha', async () => {
    fake.people.push({ id: 'a', full_name: 'Ali', role: 'haydovchi', is_active: true }, { id: 'b', full_name: 'Vali', role: 'prorab', is_active: false })
    expect(await listDirectory()).toHaveLength(2)
    expect(fake.calls).toContainEqual(['from', 'profile_directory'])
    expect(arg('select')).toBe('id, company_id, full_name, role, is_active')
    expect((await listActiveDirectory(['haydovchi'])).map((p) => p.id)).toEqual(['a'])
  })

  it('directoryNames: bo‘sh id — so‘rovsiz; takrorlar bitta so‘rovda', async () => {
    expect((await directoryNames([null, undefined, ''])).size).toBe(0)
    expect(fake.calls).toEqual([])
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'prorab' })
    const names = await directoryNames(['p1', 'p1', null, 'p2'])
    expect(names.get('p1')?.full_name).toBe('Ali')
    expect(fake.calls).toContainEqual(['in', 'id', ['p1', 'p2']])
  })

  it('attachNames: id ustunidan ism maydoniga; topilmasa — null', async () => {
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'prorab' })
    const rows = await attachNames(
      [
        { created_by: 'p1', created_by_name: null as string | null, decided_by: 'x', decided_by_name: null as string | null },
        { created_by: null, created_by_name: 'eski', decided_by: null, decided_by_name: null },
      ],
      [
        ['created_by', 'created_by_name'],
        ['decided_by', 'decided_by_name'],
      ],
    )
    expect(rows).toEqual([
      { created_by: 'p1', created_by_name: 'Ali', decided_by: 'x', decided_by_name: null },
      { created_by: null, created_by_name: null, decided_by: null, decided_by_name: null },
    ])
  })

  it.each([
    ['movements', () => listMovements(), { data: [{ id: 'm1', created_by: 'p1', object: null, material: null }], error: null, count: 1 }, 'created_by_name'],
    ['material_requests', () => listRequests(), { data: [{ id: 'r1', created_by: 'p1', decided_by: null, object: null, material: null }], error: null, count: 1 }, 'created_by_name'],
    ['inventory_counts', () => listCounts(), { data: [{ id: 'c1', created_by: 'p1', object: null }], error: null, count: 1 }, 'created_by_name'],
  ] as const)('%s: embed `profiles!…` yo‘q, ism directory dan', async (_table, run, result, field) => {
    fake.results.push(result)
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'prorab' })
    const out = (await run()) as unknown as { rows: Record<string, unknown>[] }
    expect(out.rows[0]?.[field]).toBe('Ali')
    for (const [, sel] of callsOf('select')) expect(String(sel)).not.toContain('profiles!')
  })

  it('listMyPurchases: xaridor ismi va qabul holati (purchase_receipts)', async () => {
    fake.results.push({ data: [{ id: 'pu1', buyer_id: 'p1', qty_base: '500', object: null, material: null, supplier: null }], error: null })
    fake.results.push({ data: [{ purchase_id: 'pu1', received_qty_base: '250', remaining_qty_base: '250', receipt_count: 1, last_received_at: null }], error: null })
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'haydovchi' })
    const [p] = await listMyPurchases('p1')
    expect(p).toMatchObject({ buyer_name: 'Ali', receipt: { received_qty_base: '250', receipt_count: 1 } })
    expect(fake.calls).toContainEqual(['from', 'purchase_receipts'])
  })

  it('listAllTransfers: eksport — filtr, ismlar; noto‘g‘ri obyekt id — xato', async () => {
    fake.results.push({ data: [{ id: 't1', created_by: 'p1', from_object: null, to_object: null, material: null }], error: null, count: 1 })
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'prorab' })
    const rows = await listAllTransfers({ status: 'yuborildi' })
    expect(rows[0]?.created_by_name).toBe('Ali')
    expect(fake.calls).toContainEqual(['eq', 'status', 'yuborildi'])
    await expect(listAllTransfers({ objectId: 'x;drop' })).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

describe('correct_entry', () => {
  it('RPC argumentlari; harakatda summa yuborilmaydi; sabab qirqiladi', async () => {
    await correctEntry({ table: 'movements', id: 'm1', qtyInput: '5', unitId: null, totalAmount: '100', note: '  sabab  ' })
    expect(fake.calls).toContainEqual([
      'rpc',
      'correct_entry',
      { p_table: 'movements', p_id: 'm1', p_qty_input: '5', p_unit_id: null, p_total_amount: null, p_note: 'sabab' },
    ])
    await correctEntry({ table: 'purchases', id: 'p1', qtyInput: null, unitId: 'u', totalAmount: '1250000', note: 'x' })
    expect(callsOf('rpc')[1]?.[2]).toMatchObject({ p_table: 'purchases', p_total_amount: '1250000', p_unit_id: 'u' })
  })

  it.each(['correct_invalid', 'correct_not_found', 'correct_forbidden', 'correct_window_passed', 'correct_linked'] as const)(
    '%s — barqaror kalit va o‘zbekcha matn',
    async (hint) => {
      fake.results.push({ data: null, error: { code: '55000', hint, message: 'x' } })
      const err = await correctEntry({ table: 'movements', id: 'm', qtyInput: '1', unitId: null, note: 'n' }).catch((e: unknown) => e)
      expect((err as RepoError).code).toBe(hint)
      expect(t.errors[hint]).toBeTruthy()
    },
  )
})

describe('yangi hint’lar (docs/audit-fixes.md)', () => {
  const HINTS = [
    'movement_rpc_only',
    'qty_too_small',
    'qty_too_large',
    'price_too_large',
    'transfer_over_receipt',
    'alert_close_note_required',
    'profile_protected',
    'login_target_not_found',
    'photo_hash_invalid',
    'correct_invalid',
    'correct_not_found',
    'correct_forbidden',
    'correct_window_passed',
    'correct_linked',
    'supplier_merge_forbidden',
    'supplier_merge_invalid',
    'supplier_not_found',
    'notification_health_forbidden',
  ] as const
  it.each(HINTS)('%s — SERVER_HINTS da, matn bor, server xabari ko‘rsatilmaydi', (hint) => {
    expect(SERVER_HINTS[hint].showServerMessage).toBe(false)
    expect(t.errors[hint].length).toBeGreaterThan(5)
    expect(toRepoError({ code: '42501', hint, message: 'server' })).toMatchObject({ code: hint, userMessage: null })
  })
  it('Edge kalitlari: forbidden_target, rate_limited — matn bor', () => {
    expect(t.errors.forbidden_target).toBeTruthy()
    expect(t.errors.rate_limited).toBeTruthy()
  })
})

describe('sotuvchilar (admin)', () => {
  it('supplierPatchToRow: nom bo‘shliqlari, STIR raqamlari; noto‘g‘ri STIR / bo‘sh nom — xato', () => {
    expect(supplierPatchToRow({ name: '  Chilonzor   bozori ', phone: ' ', tin: '123 456 789', note: '' })).toEqual({
      name: 'Chilonzor bozori',
      phone: null,
      tin: '123456789',
      note: null,
    })
    expect(supplierPatchToRow({ tin: '' })).toEqual({ tin: null })
    expect(() => supplierPatchToRow({ tin: '12345' })).toThrow(RepoError)
    expect(() => supplierPatchToRow({ name: '   ' })).toThrow(RepoError)
  })

  it('updateSupplier / softDelete / restore — UPDATE id bo‘yicha', async () => {
    fake.results.push({ data: { id: 's1' }, error: null }, { data: { id: 's1' }, error: null }, { data: { id: 's1' }, error: null })
    await updateSupplier('s1', { note: 'ok' })
    await softDeleteSupplier('s1')
    await restoreSupplier('s1')
    const updates = callsOf('update').map((c) => c[1] as Record<string, unknown>)
    expect(updates[0]).toEqual({ note: 'ok' })
    expect(updates[1]?.deleted_at).toBeTruthy()
    expect(updates[2]).toEqual({ deleted_at: null })
  })

  it('mergeSuppliers: RPC, ko‘chirilgan xaridlar soni; supplier_merge_forbidden', async () => {
    fake.results.push({ data: 3, error: null })
    expect(await mergeSuppliers('keep', 'merge')).toBe(3)
    expect(fake.calls).toContainEqual(['rpc', 'merge_suppliers', { p_keep: 'keep', p_merge: 'merge' }])
    fake.results.push({ data: null, error: { code: '42501', hint: 'supplier_merge_forbidden', message: 'x' } })
    await expect(mergeSuppliers('a', 'b')).rejects.toMatchObject({ code: 'supplier_merge_forbidden' })
  })
})

describe('firma sozlamalari: tinch soatlar, Telegram holati', () => {
  it('hhmm: "22:00:00" → "22:00"; null — o‘chiq', () => {
    expect(hhmm('22:00:00')).toBe('22:00')
    expect(hhmm('07:30')).toBe('07:30')
    expect(hhmm(null)).toBeNull()
    expect(hhmm('x')).toBeNull()
  })

  it('getCompanySettings tinch soatlarni o‘qiydi; update — faqat berilgan ustunlar', async () => {
    fake.results.push({
      data: { receipt_mismatch_pct: '2', price_deviation_pct: '8', price_avg_window: 5, quiet_hours_start: '22:00:00', quiet_hours_end: null },
      error: null,
    })
    const s = await getCompanySettings('c')
    expect(s).toMatchObject({ quietHoursStart: '22:00', quietHoursEnd: null })
    expect(String(arg('select'))).toContain('quiet_hours_start::text')
    fake.calls.length = 0
    fake.results.push({ data: { id: 'c' }, error: null })
    await updateCompanySettings('c', { quietHoursStart: null, quietHoursEnd: null })
    expect(arg('update')).toEqual({ quiet_hours_start: null, quiet_hours_end: null })
  })

  it('notification_health: normallashtirish va RPC', async () => {
    const raw = {
      last_sent_at: '2026-10-26T10:00:00Z',
      stuck_pending_count: 2,
      failed_7d_count: '1',
      last_errors: [{ id: 'o1', kind: 'alert', status: 'failed', last_error: 'chat not found', attempts: 3, updated_at: '2026-10-26T09:00:00Z' }, 'axlat'],
      blocked_profiles: [{ profile_id: 'p1', full_name: 'Ali', role: 'prorab', telegram_blocked_at: '2026-10-25T00:00:00Z' }],
    }
    expect(normalizeHealth(raw)).toEqual({
      lastSentAt: '2026-10-26T10:00:00Z',
      stuckPendingCount: 2,
      failed7dCount: 1,
      lastErrors: [{ id: 'o1', kind: 'alert', status: 'failed', lastError: 'chat not found', attempts: 3, updatedAt: '2026-10-26T09:00:00Z' }],
      blockedProfiles: [{ profileId: 'p1', fullName: 'Ali', role: 'prorab', blockedAt: '2026-10-25T00:00:00Z' }],
    })
    expect(normalizeHealth(null)).toMatchObject({ lastSentAt: null, stuckPendingCount: 0, lastErrors: [], blockedProfiles: [] })
    fake.results.push({ data: raw, error: null })
    expect((await getNotificationHealth()).stuckPendingCount).toBe(2)
    expect(fake.calls).toContainEqual(['rpc', 'notification_health', undefined])
  })
})

describe('profil, podotchet, so‘rov, alertlar', () => {
  it('setMyNotifyWorkflow: faqat notify_workflow ustuni, o‘z id si', async () => {
    fake.results.push({ data: null, error: null })
    await setMyNotifyWorkflow('me', false)
    expect(arg('update')).toEqual({ notify_workflow: false })
    expect(fake.calls).toContainEqual(['eq', 'id', 'me'])
  })

  it('updateAdvanceNote: faqat izoh (summa va sana yuborilmaydi)', async () => {
    fake.results.push({ data: { id: 'a1' }, error: null })
    await updateAdvanceNote('a1', '  yangi izoh ')
    expect(arg('update')).toEqual({ note: 'yangi izoh' })
    fake.calls.length = 0
    fake.results.push({ data: { id: 'a1' }, error: null })
    await updateAdvanceNote('a1', ' ')
    expect(arg('update')).toEqual({ note: null })
  })

  it('listMyAdvances: oluvchi yoki beruvchi bo‘yicha, ismlar bilan', async () => {
    fake.results.push({ data: [{ id: 'a1', recipient_id: 'me', created_by: 'bux', kind: 'berildi', amount: '100' }], error: null })
    fake.people.push({ id: 'me', full_name: 'Ali', role: 'haydovchi' }, { id: 'bux', full_name: 'Buxgalter', role: 'buxgalter' })
    const [a] = await listMyAdvances('me', 'recipient')
    expect(a).toMatchObject({ recipient_name: 'Ali', created_by_name: 'Buxgalter' })
    expect(fake.calls).toContainEqual(['eq', 'recipient_id', 'me'])
    fake.calls.length = 0
    await listMyAdvances('bux', 'creator')
    expect(fake.calls).toContainEqual(['eq', 'created_by', 'bux'])
  })

  it('approveRequest: izoh ixtiyoriy (decision_note)', async () => {
    fake.results.push({ data: { id: 'r1' }, error: null }, { data: { id: 'r1' }, error: null })
    await approveRequest('r1')
    await approveRequest('r1', ' 2 kunda ')
    const updates = callsOf('update').map((c) => c[1])
    expect(updates).toEqual([{ status: 'tasdiqlandi' }, { status: 'tasdiqlandi', decision_note: '2 kunda' }])
  })

  it('listSiteAlerts: faqat obyekt turlari, ochiq holatlar', async () => {
    fake.results.push({ data: [], error: null })
    await listSiteAlerts(5)
    expect(fake.calls).toContainEqual(['in', 'type', SITE_ALERT_TYPES])
    expect(fake.calls).toContainEqual(['in', 'status', ['yangi', 'korildi']])
    expect(fake.calls).toContainEqual(['limit', 5])
    expect([...SITE_ALERT_TYPES].sort()).toEqual(['manfiy_qoldiq', 'normadan_oshish', 'otkazma_farqi', 'smetadan_ortiq_sorov', 'smetasiz_chiqim'])
  })
})

describe('Edge Function’lar', () => {
  it('requestPhotoHash: POST {table, id}; xato yoki tarmoq — null, hech qachon tashlamaydi', async () => {
    fake.invoke.mockResolvedValueOnce({ data: { sha256: 'a'.repeat(64), duplicate: true }, error: null })
    expect(await requestPhotoHash('movements', 'm1')).toEqual({ sha256: 'a'.repeat(64), duplicate: true })
    expect(fake.invoke).toHaveBeenCalledWith('photo-hash', { body: { table: 'movements', id: 'm1' } })
    fake.invoke.mockResolvedValueOnce({ data: null, error: new Error('network') })
    expect(await requestPhotoHash('purchases', 'p1')).toBeNull()
    fake.invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(requestPhotoHash('purchases', 'p1')).resolves.toBeNull()
  })

  it('receipt-lookup 429 rate_limited → RepoError(rate_limited)', async () => {
    const { FunctionsHttpError } = await import('@supabase/supabase-js')
    const response = new Response(JSON.stringify({ error: 'rate_limited', retry_after_sec: 60 }), { status: 429 })
    fake.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(response) })
    await expect(receiptLookup('https://ofd.soliq.uz/check?t=1')).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
