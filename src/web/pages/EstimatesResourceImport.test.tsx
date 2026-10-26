// Resurs smetasi (ЛРВ) importi: aniqlash, ulush, shifr bo'yicha moslash, bitta tugma bilan katalogga
// qo'shish, saqlash va shifrlarni eslab qolish. Sintetik ma'lumot (src/domain/estimate/__fixtures__).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as XLSX from 'xlsx'
import * as authRepo from '@/data/authRepo'
import { toRepoError } from '@/data/errors'
import * as estimatesRepo from '@/data/estimatesRepo'
import * as materialsRepo from '@/data/materialsRepo'
import type { Material } from '@/data/types'
import { aggregateMaterials, detectResourceLayout, parseResourceEstimate, selectMainMaterials } from '@/domain/estimate'
import { RESOURCE_LRV } from '@/domain/estimate/__fixtures__/resourceLrv'
import { RESOURCE_SVOD } from '@/domain/estimate/__fixtures__/resourceVariants'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { unknownKeysOf } from '@/web/estimates/resourceModel'
import { makeAlias, makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Smeta'], Sheets: { Smeta: {} } })),
  utils: { sheet_to_json: vi.fn() },
}))
vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u-admin', email: 'admin@firma.uz', mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 10,
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('o-a', 'Obyekt A')]) }))
vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
  getMaterial: vi.fn(),
  createMaterial: vi.fn(),
}))
vi.mock('@/data/materialUnitsRepo', () => ({ addMaterialUnit: vi.fn() }))
vi.mock('@/data/materialAliasesRepo', () => ({ addMaterialAlias: vi.fn() }))
vi.mock('@/data/estimatesRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/estimatesRepo')>()),
  listEstimates: vi.fn(),
  listEstimateItems: vi.fn(),
  importEstimate: vi.fn(),
  setCurrentEstimate: vi.fn(async () => undefined),
  createEstimateMaterials: vi.fn(),
  rememberEstimateAliases: vi.fn(),
}))
vi.mock('@/data/normsRepo', () => ({ listNormUsage: vi.fn(async () => []) }))
vi.mock('@/data/estimateTemplatesRepo', () => ({
  findTemplateBySignature: vi.fn(async () => null),
  saveTemplate: vi.fn(async () => undefined),
}))

// Birinchi render — dangasa (lazy) sahifa yuklanishi bilan; yuklangan mashinada 5 s kamlik qiladi
vi.setConfig({ testTimeout: 30000 })

const tw = t.estimates.wizard
const tr = tw.resource
const te = t.estimates

// Katalog: suv — shifr alias'i bilan, beton — smetadagi asl nom muqobil nom sifatida
const suv = makeMaterial('m-suv', 'Suv', 'm³', { aliases: [makeAlias('a-c', 'm-suv', '009219', 'code')] })
const beton = makeMaterial('m-bet', 'Beton B15', 'm³', {
  aliases: [makeAlias('a-b', 'm-bet', 'БЕТОН ТЯЖЕЛЫЙ КЛАССА В15 /М-200/')],
})
let catalog: Material[] = []

/** Domen funksiyalari bo'yicha kutilgan qiymatlar (hisob bitta joyda — resource.ts). */
function expected(rows: typeof RESOURCE_LRV) {
  const layout = detectResourceLayout(rows)
  if (!layout) throw new Error('layout')
  const parsed = parseResourceEstimate(rows, layout)
  const list = aggregateMaterials(parsed.resources, ['material', 'equipment', 'unknown'])
  const unknown = unknownKeysOf(list, parsed.resources)
  const main = (pct: string) => selectMainMaterials(list, pct)
  /** Asosiy, katalogda yo'q (suv — shifr, beton — nom bo'yicha topiladi), turi ma'lum. */
  const newAt = (pct: string) =>
    list.filter((m) => main(pct).has(m.key) && !unknown.has(m.key) && !['009219', '043101'].includes(m.code))
  return { list, unknown, main, newAt }
}

function open(role: Role = 'admin') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/estimates'] })} />)
}

const next = () => fireEvent.click(screen.getAllByRole('button', { name: tw.next }).at(-1) as HTMLElement)

beforeEach(() => {
  vi.clearAllMocks()
  catalog = [suv, beton]
  vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue(RESOURCE_LRV as never)
  vi.mocked(materialsRepo.listMaterials).mockImplementation(async () => catalog)
  vi.mocked(estimatesRepo.listEstimates).mockResolvedValue([])
  vi.mocked(estimatesRepo.listEstimateItems).mockResolvedValue([])
  vi.mocked(estimatesRepo.importEstimate).mockImplementation(async (input) => input.id)
  vi.mocked(estimatesRepo.rememberEstimateAliases).mockResolvedValue(5)
  // Bazadagi RPC kabi: material + asosiy birlik + qo'shimcha birliklar + shifr alias'i
  vi.mocked(estimatesRepo.createEstimateMaterials).mockImplementation(async (items) =>
    items.map((it) => {
      const id = `m-new-${it.key}`
      catalog = [
        ...catalog,
        makeMaterial(id, it.name, it.base_unit, {
          units: (it.units ?? []).map((u, i) => makeUnit(`${id}-u${i}`, id, u.unit, u.factor)),
          aliases: it.code ? [makeAlias(`${id}-c`, id, it.code, 'code')] : [],
        }),
      ]
      return { key: it.key, material_id: id, created: true }
    }),
  )
})

/** Ustani ochadi, faylni tanlaydi; resurs banneri chiqadi. */
async function startWizard(role: Role = 'admin') {
  open(role)
  fireEvent.click(await screen.findByRole('button', { name: te.upload }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(tw.file), { target: { files: [new File(['x'], 'lrv.xlsx')] } })
  await screen.findByText(tw.fileChosen('lrv.xlsx'))
  return screen.findByTestId('resource-banner')
}

async function toCatalog(role: Role = 'admin') {
  await startWizard(role)
  next()
  return screen.findByTestId('resource-match-summary')
}

describe('Resurs smetasi importi', () => {
  it('aniqlanadi: banner (ishlar, turlar, jami), mehnat/texnika o‘tkaziladi; varaq/ustun bosqichlari yo‘q', async () => {
    const banner = await startWizard()
    expect(within(banner).getByText(tr.detected)).toBeInTheDocument()
    expect(within(banner).getByText(tr.kinds.labor)).toBeInTheDocument()
    expect(within(banner).getByText(tr.kinds.equipment)).toBeInTheDocument()
    expect(within(banner).getByText(/3 680 000/)).toBeInTheDocument()
    expect(within(banner).getByText(/133 589 960/)).toBeInTheDocument()
    expect(within(banner).getByText(/avtomatik o‘tkazib yuboriladi/)).toBeInTheDocument()
    // КОННЕКТОР RJ-45 — tur ustuni to'ldirilmagan
    expect(within(banner).getByText(tr.kinds.unknown)).toBeInTheDocument()
    expect(within(banner).getByText(tr.unknownNote(1))).toBeInTheDocument()
    // Stepper: varaq, ustunlar, qatorlar yo'q
    expect(screen.queryByRole('button', { name: new RegExp(tw.steps.columns) })).not.toBeInTheDocument()
    next()
    expect(await screen.findByRole('heading', { name: tw.steps.catalog })).toBeInTheDocument()
    expect(screen.getByText(tw.stepOf(2, 5))).toBeInTheDocument()
  })

  it('tur ustunlarisiz (SVOD): jami — resurslar yig‘indisi, 0 yoki NaN yo‘q', async () => {
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue(RESOURCE_SVOD as never)
    const banner = await startWizard()
    expect(banner.textContent).not.toMatch(/NaN/)
    expect(within(banner).getByText(tr.kinds.labor)).toBeInTheDocument()
    expect(within(banner).queryByText(tr.kinds.equipment)).not.toBeInTheDocument()
    expect(within(banner).getByText(tr.grand)).toBeInTheDocument()
    expect(within(banner).queryByText(/^0$/)).not.toBeInTheDocument()
  })

  it('“Sozlamalarni ochish” — oddiy oqim (sarlavha, ustunlar), qaytish mumkin', async () => {
    const banner = await startWizard()
    fireEvent.click(within(banner).getByRole('button', { name: tr.openSettings }))
    expect(await screen.findByText(tw.headerDetected(2))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tr.backToResource }))
    expect(await screen.findByTestId('resource-match-summary')).toBeInTheDocument()
  })

  it('shifr va nom bo‘yicha avtomatik moslash; ulush yangi materiallar sonini o‘zgartiradi', async () => {
    const summary = await toCatalog()
    expect(summary).toHaveTextContent(tr.matchSummary(1, 1, 0))
    const { main, newAt } = expected(RESOURCE_LRV)
    // standart — 95 %
    expect(screen.getByRole('button', { name: tr.shareOption('95') })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('resource-share')).toHaveTextContent(`${main('95').size} ta material`)
    expect(screen.getByText(tr.newCount(newAt('95').length))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: tr.create(newAt('95').length) })).toBeInTheDocument()
    expect(screen.getByText(tr.unknownCount(1))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: tr.shareOption('80') }))
    expect(screen.getByTestId('resource-share')).toHaveTextContent(`${main('80').size} ta material`)
    expect(screen.getByText(tr.newCount(newAt('80').length))).toBeInTheDocument()
    expect(newAt('95').length).toBeGreaterThan(newAt('80').length)
    // moslanmaganlar bor — keyingi bosqichga o'tib bo'lmaydi
    expect(screen.getAllByRole('button', { name: tw.next }).at(-1)).toBeDisabled()
  })

  it('ro‘yxat standart yig‘ilgan; “Ko‘rish” — qidiruv bilan', async () => {
    await toCatalog()
    expect(screen.queryByTestId('group-r:009219')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tr.show }))
    expect(await screen.findByTestId('group-r:009219')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(tw.search), { target: { value: '043101' } })
    expect(screen.queryByTestId('group-r:009219')).not.toBeInTheDocument()
    expect(screen.getByTestId('group-r:043101')).toBeInTheDocument()
  })

  it('bitta tugma: RPC payload, moslar to‘ladi, birliklar avtomatik, saqlash shifr bilan va eslab qolish', async () => {
    await toCatalog()
    const { list, unknown, newAt } = expected(RESOURCE_LRV)
    const newItems = newAt('95')
    fireEvent.click(screen.getByRole('button', { name: tr.create(newItems.length) }))
    expect(await screen.findByText(tr.created(newItems.length, 0))).toBeInTheDocument()
    const payload = vi.mocked(estimatesRepo.createEstimateMaterials).mock.calls[0]?.[0] ?? []
    expect(payload.map((p) => p.code)).toEqual(newItems.map((m) => m.code))
    const kirpich = payload.find((p) => p.code === '011001')
    expect(kirpich).toMatchObject({
      name: 'Кирпич керамический М-150',
      base_unit: 'dona',
      alias: 'КИРПИЧ КЕРАМИЧЕСКИЙ М-150',
      units: [{ unit: '1000 dona', factor: '1000', variant: null }],
    })
    expect(payload.find((p) => p.code === 'С124-9221')).toMatchObject({ base_unit: 't', units: null })
    expect(screen.getByTestId('resource-match-summary')).toHaveTextContent(tr.matchSummary(1, 1, newItems.length))
    expect(screen.getByText(tr.newCount(0))).toBeInTheDocument()

    next()
    // "М3", "Т", "1000ШТ", "КОМПЛ" — hammasi avtomatik: savol yo'q, lekin ko'rinadi va o'zgartiriladi
    expect(await screen.findByText(tw.unitsNone)).toBeInTheDocument()
    const autoSection = screen.getByRole('region', { name: /Avtomatik aniqlangan/ })
    expect(screen.queryByText(/1000ШТ = 1\s000 dona/)).not.toBeInTheDocument()
    fireEvent.click(within(autoSection).getByRole('button', { name: tr.show }))
    const kirpichRow = screen.getByText(/1000ШТ = 1\s000 dona/)
    const kirpichCard = kirpichRow.closest('li') as HTMLElement
    fireEvent.click(within(kirpichCard).getByRole('button', { name: 'dona' }))
    expect(within(kirpichCard).getByText(tr.unitsAutoRow('1000ШТ', '1', 'dona'))).toBeInTheDocument()
    fireEvent.click(within(kirpichCard).getByRole('button', { name: '1000 dona' }))
    expect(within(kirpichCard).getByText(/1000ШТ = 1\s000 dona/)).toBeInTheDocument()
    next()
    const minor = list.length - newItems.length - 2 - unknown.size
    expect(await screen.findByText(tr.minorNotice(minor))).toBeInTheDocument()
    // line_sum — jami yaxlitlash farqisiz
    expect(screen.queryByText(/narxlar 2 xonagacha yaxlitlanadi/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tw.saveButton }))

    await waitFor(() => expect(estimatesRepo.rememberEstimateAliases).toHaveBeenCalled())
    const input = vi.mocked(estimatesRepo.importEstimate).mock.calls[0]?.[0]
    const items = input?.items ?? []
    expect(items).toHaveLength(list.length)
    expect(items.every((i) => typeof i.line_sum === 'string')).toBe(true)
    const water = items.find((i) => i.code === '009219')
    expect(water).toMatchObject({ item_type: 'material', material_id: 'm-suv', unit_id: 'm-suv-base' })
    expect(Number(water?.line_sum)).toBe(34000)
    expect(items.find((i) => i.code === '011001')).toMatchObject({ item_type: 'material', unit_id: expect.stringMatching(/-u0$/) })
    expect(items.find((i) => i.code === '033001')).toMatchObject({ item_type: 'ish', material_id: null, name: 'ГВОЗДИ СТРОИТЕЛЬНЫЕ' })
    expect(items.find((i) => i.name === 'КОННЕКТОР RJ-45')).toMatchObject({ item_type: 'ish', material_id: null })
    const [savedId, remembered] = vi.mocked(estimatesRepo.rememberEstimateAliases).mock.calls[0] ?? ['', []]
    expect(savedId).toBe(input?.id)
    expect(remembered).toContainEqual({ material_id: 'm-suv', code: '009219', name: 'ВОДА' })
    expect(remembered.some((r) => r.code === '033001')).toBe(false)
  })

  it('eslab qolish xatosi — ogohlantirish, smeta saqlangan (versiya ochiladi)', async () => {
    vi.mocked(estimatesRepo.rememberEstimateAliases).mockRejectedValue(
      toRepoError({ code: '22023', hint: 'estimate_aliases_invalid', message: 'Qator 1: x' }),
    )
    await toCatalog()
    fireEvent.click(screen.getByRole('button', { name: /yangi materialni katalogga qo‘shish/ }))
    await screen.findByText(tr.newCount(0))
    next()
    await screen.findByText(tw.unitsNone)
    next()
    fireEvent.click(await screen.findByRole('button', { name: tw.saveButton }))
    expect(await screen.findByText(tr.rememberFailed)).toBeInTheDocument()
    expect(estimatesRepo.importEstimate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('button', { name: tw.saveButton })).not.toBeInTheDocument())
  })

  it('buxgalter: katalogga qo‘sha olmaydi — yangilarini “Ish” sifatida saqlaydi', async () => {
    await toCatalog('buxgalter')
    expect(screen.queryByRole('button', { name: /katalogga qo‘shish/ })).not.toBeInTheDocument()
    expect(screen.getByText(tr.createAdminOnly)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /“Ish” sifatida saqlash/ }))
    expect(screen.getByText(tr.newCount(0))).toBeInTheDocument()
    next()
    await screen.findByText(tw.unitsNone)
    next()
    fireEvent.click(await screen.findByRole('button', { name: tw.saveButton }))
    await waitFor(() => expect(estimatesRepo.importEstimate).toHaveBeenCalled())
    expect(estimatesRepo.createEstimateMaterials).not.toHaveBeenCalled()
    const items = vi.mocked(estimatesRepo.importEstimate).mock.calls[0]?.[0].items ?? []
    expect(items.filter((i) => i.item_type === 'material').map((i) => i.material_id).sort()).toEqual(['m-bet', 'm-suv'])
  })

  it('nofaol material ham shifr bo‘yicha topiladi — belgi bilan', async () => {
    catalog = [
      suv,
      beton,
      makeMaterial('m-off', 'Qorishma', 'm³', { is_active: false, aliases: [makeAlias('a-o', 'm-off', '040101', 'code')] }),
    ]
    const summary = await toCatalog()
    expect(summary).toHaveTextContent(tr.matchSummary(2, 1, 0))
    expect(screen.getByText(tr.inactiveCount(1))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tr.show }))
    fireEvent.change(await screen.findByLabelText(tw.search), { target: { value: '040101' } })
    expect(within(screen.getByTestId('group-r:040101')).getByText(tw.inactive)).toBeInTheDocument()
  })

  it('buxgalter: aniqlanmagan birlik — “Ish deb saqlash” bilan chiqish yo‘li', async () => {
    // Suv litrda — "М3" ni avtomatik aniqlab bo'lmaydi, buxgalter yangi birlik qo'sha olmaydi
    catalog = [makeMaterial('m-suv', 'Suv', 'l', { aliases: [makeAlias('a-c', 'm-suv', '009219', 'code')] }), beton]
    await toCatalog('buxgalter')
    fireEvent.click(screen.getByRole('button', { name: /“Ish” sifatida saqlash/ }))
    next()
    const card = await screen.findByText(tw.unitQuestion('М3', 'Suv'))
    expect(screen.getAllByRole('button', { name: tw.next }).at(-1)).toBeDisabled()
    fireEvent.click(within(card.closest('li') as HTMLElement).getByRole('button', { name: tw.unitAsWork }))
    expect(await screen.findByText(tw.unitsNone)).toBeInTheDocument()
    next()
    fireEvent.click(await screen.findByRole('button', { name: tw.saveButton }))
    await waitFor(() => expect(estimatesRepo.importEstimate).toHaveBeenCalled())
    const items = vi.mocked(estimatesRepo.importEstimate).mock.calls[0]?.[0].items ?? []
    expect(items.find((i) => i.code === '009219')).toMatchObject({ item_type: 'ish', material_id: null })
  })

  it('oddiy smeta — resurs rejimi yo‘q', async () => {
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue([
      ['№', 'Наименование', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'],
      ['1', 'Цемент М500', 'т', 2, 1500000, 3000000],
    ] as never)
    open()
    fireEvent.click(await screen.findByRole('button', { name: te.upload }, { timeout: 5000 }))
    fireEvent.change(screen.getByLabelText(tw.file), { target: { files: [new File(['x'], 'oddiy.xlsx')] } })
    await screen.findByText(tw.fileChosen('oddiy.xlsx'))
    expect(screen.queryByTestId('resource-banner')).not.toBeInTheDocument()
    next()
    expect(await screen.findByText(tw.headerDetected(1))).toBeInTheDocument()
  })
})
