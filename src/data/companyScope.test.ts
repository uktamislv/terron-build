// Faol firma filtri (super_admin): ro'yxat so'rovlariga `company_id = faol firma` qo'shiladi; o'rnatilmagan
// bo'lsa (boshqa rollar) — so'rov o'zgarmaydi.
import { listAlerts } from './alertsRepo'
import { listBalances, listCashHistory } from './cashRepo'
import { companyScopeArg, getCompanyScope, scopeCompany, setCompanyScope } from './companyScope'
import { cleanCompanyName, createCompany, getNotificationHealth, listCompanies, renameCompany, setCompanyActive } from './companiesRepo'
import { createEstimateMaterials } from './estimatesRepo'
import { listAuditFeed, listDeletedRecords } from './historyRepo'
import { getDashboardDaily, getDashboardSummary, getNormOverview, getSpendBreakdown } from './reportsRepo'
import { listExpenseCategories, sortOrderPatches } from './expenseCategoriesRepo'
import { listExpenses } from './expensesRepo'
import { listMaterials } from './materialsRepo'
import { listMovements } from './movementsRepo'
import { listObjectMembers } from './objectMembersRepo'
import { listObjects } from './objectsRepo'
import { listDirectory } from './profileDirectory'
import { listProfiles } from './profilesRepo'
import { listPurchases } from './purchasesRepo'
import { listRequests } from './requestsRepo'
import { listStock } from './stockRepo'
import { listSuppliers } from './suppliersRepo'
import { listTransfers } from './transfersRepo'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({ calls: [] as [string, ...unknown[]][], results: [] as unknown[] }))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject)
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
      return fakeQuery(fake.calls, () => fake.results.shift() ?? { data: [], error: null, count: 0 })
    },
    rpc: (name: string, args: unknown) => {
      fake.calls.push(['rpc', name, args])
      return Promise.resolve(fake.results.shift() ?? { data: null, error: null })
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
  setCompanyScope(null)
})

afterAll(() => setCompanyScope(null))

const companyFilters = () => fake.calls.filter((c) => c[0] === 'eq' && c[1] === 'company_id')

const LISTS: [string, () => Promise<unknown>][] = [
  ['materials', () => listMaterials()],
  ['objects', () => listObjects()],
  ['object_members', () => listObjectMembers()],
  ['profiles', () => listProfiles()],
  ['profile_directory', () => listDirectory()],
  ['suppliers', () => listSuppliers()],
  ['purchases', () => listPurchases()],
  ['expenses', () => listExpenses()],
  ['expense_categories', () => listExpenseCategories()],
  ['movements', () => listMovements()],
  ['stock_balances', () => listStock()],
  ['cash_balances', () => listBalances()],
  ['alerts', () => listAlerts()],
  ['material_requests', () => listRequests()],
  ['transfers', () => listTransfers()],
]

describe('companyScope', () => {
  it('scopeCompany: faol firma yo‘q — so‘rov o‘zgarmaydi; bor — eq(company_id)', () => {
    const q = { eq: vi.fn(() => q) }
    expect(scopeCompany(q)).toBe(q)
    expect(q.eq).not.toHaveBeenCalled()
    setCompanyScope('c2')
    expect(getCompanyScope()).toBe('c2')
    scopeCompany(q)
    expect(q.eq).toHaveBeenCalledWith('company_id', 'c2')
  })

  it.each(LISTS)('%s: boshqa rollar (filtr yo‘q) — company_id filtri qo‘shilmaydi', async (_table, run) => {
    await run().catch(() => undefined)
    expect(companyFilters()).toEqual([])
  })

  it.each(LISTS)('%s: super_admin faol firmasi — company_id = faol firma', async (table, run) => {
    setCompanyScope('c2')
    await run().catch(() => undefined)
    expect(fake.calls).toContainEqual(['from', table])
    expect(companyFilters()[0]).toEqual(['eq', 'company_id', 'c2'])
  })

  it('podotchet tarixi: uchala manba (berilgan, xarid, xarajat) faol firma bo‘yicha', async () => {
    setCompanyScope('c2')
    await listCashHistory()
    expect(companyFilters()).toHaveLength(3)
  })
})

describe('companiesRepo (super_admin)', () => {
  it('listCompanies — o‘chirilmaganlar, nom bo‘yicha; faol firma filtri qo‘llanmaydi', async () => {
    setCompanyScope('c2')
    fake.results.push({ data: [{ id: 'c1', name: 'A', is_active: true, created_at: '2026-10-01T00:00:00Z' }], error: null })
    expect(await listCompanies()).toHaveLength(1)
    expect(fake.calls).toContainEqual(['is', 'deleted_at', null])
    expect(companyFilters()).toEqual([])
  })

  it('createCompany — RPC create_company (nom tozalanadi), javob id lari', async () => {
    fake.results.push({ data: { company_id: 'c9', admin_profile_id: 'p9' }, error: null })
    expect(await createCompany({ name: '  Yangi   Qurilish ', adminFullName: ' Ali ', adminPhone: '90 123 45 67' })).toEqual({
      companyId: 'c9',
      adminProfileId: 'p9',
    })
    expect(fake.calls).toContainEqual([
      'rpc',
      'create_company',
      { p_name: 'Yangi Qurilish', p_admin_full_name: 'Ali', p_admin_phone: '90 123 45 67' },
    ])
  })

  it('createCompany — server hint (company_create_forbidden) tushunarli kodga', async () => {
    fake.results.push({ data: null, error: { code: '42501', message: 'x', hint: 'company_create_forbidden' } })
    await expect(createCompany({ name: 'A', adminFullName: 'B', adminPhone: '901234567' })).rejects.toMatchObject({ code: 'company_create_forbidden' })
  })

  it('renameCompany / setCompanyActive — companies update; bo‘sh nom yuborilmaydi', async () => {
    fake.results.push({ data: { id: 'c1' }, error: null }, { data: { id: 'c1' }, error: null })
    await renameCompany('c1', ' Firma  1 ')
    expect(fake.calls).toContainEqual(['update', { name: 'Firma 1' }])
    await setCompanyActive('c1', false)
    expect(fake.calls).toContainEqual(['update', { is_active: false }])
    expect(() => cleanCompanyName('   ')).toThrow()
    expect(() => cleanCompanyName('x'.repeat(201))).toThrow()
  })
})

describe('sortOrderPatches', () => {
  it('takror/bo‘shliqli tartib — 1..n, o‘zgarmaganlari tashlanadi', () => {
    expect(
      sortOrderPatches([
        { id: 'a', sort_order: 1 },
        { id: 'c', sort_order: 5 },
        { id: 'b', sort_order: 5 },
      ]),
    ).toEqual([
      { id: 'c', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ])
  })
})

describe('RPC p_company_id (audit 3 tekshiruvi, 10 / 2)', () => {
  const R = { from: '2026-10-01', to: '2026-10-30' }
  const RPCS: [string, () => Promise<unknown>][] = [
    ['dashboard_summary', () => getDashboardSummary(R)],
    ['dashboard_daily', () => getDashboardDaily(R)],
    ['spend_breakdown', () => getSpendBreakdown(R, 'material')],
    ['norm_overview', () => getNormOverview(null)],
    ['notification_health', () => getNotificationHealth()],
    ['audit_feed', () => listAuditFeed({ from: R.from, to: R.to })],
    ['deleted_records', () => listDeletedRecords({ from: R.from, to: R.to })],
    ['estimate_create_materials', () => createEstimateMaterials([{ key: 'k', name: 'X', base_unit: 'kg', category: null, code: null, alias: null, units: [] }])],
  ]
  const argsOf = (name: string): unknown => fake.calls.find((c) => c[0] === 'rpc' && c[1] === name)?.[2]

  it('companyScopeArg: faol firma yo‘q — {}; bor — { p_company_id }', () => {
    expect(companyScopeArg()).toEqual({})
    setCompanyScope('c2')
    expect(companyScopeArg()).toEqual({ p_company_id: 'c2' })
  })

  it.each(RPCS)('%s: faol firma yo‘q — p_company_id yuborilmaydi', async (name, run) => {
    await run().catch(() => undefined)
    const a = argsOf(name)
    expect(a === undefined || !Object.hasOwn(a as object, 'p_company_id')).toBe(true)
  })

  it.each(RPCS)('%s: super_admin faol firmasi — p_company_id = faol firma', async (name, run) => {
    setCompanyScope('c2')
    await run().catch(() => undefined)
    expect(argsOf(name)).toMatchObject({ p_company_id: 'c2' })
  })
})
