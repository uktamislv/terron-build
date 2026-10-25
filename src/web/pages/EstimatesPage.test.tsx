import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as XLSX from 'xlsx'
import * as authRepo from '@/data/authRepo'
import { toRepoError } from '@/data/errors'
import * as estimatesRepo from '@/data/estimatesRepo'
import * as templatesRepo from '@/data/estimateTemplatesRepo'
import * as aliasesRepo from '@/data/materialAliasesRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as unitsRepo from '@/data/materialUnitsRepo'
import type { Estimate, EstimateItem } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { formatSum } from '@/lib/format'
import { routes } from '@/routes'
import { COMPANY_ID, makeAlias, makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

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
  MIN_PASSWORD_LENGTH: 8,
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
}))
vi.mock('@/data/estimateTemplatesRepo', () => ({
  findTemplateBySignature: vi.fn(async () => null),
  saveTemplate: vi.fn(async () => undefined),
}))

const tw = t.estimates.wizard
const te = t.estimates

const sement = makeMaterial('m-sem', 'Sement M500', 'kg', {
  units: [makeUnit('u-qop', 'm-sem', 'qop', '50')],
  aliases: [makeAlias('a1', 'm-sem', 'Цемент М500')],
})
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const gips = makeMaterial('m-gips', 'Gips plita', 'dona')

const SHEET = [
  ['Smeta: Uy 1', null, null, null, null, null],
  ['№', 'Наименование', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'],
  ['1', 'Раздел 1. Материалы', null, null, null, null],
  ['2', 'Цемент М500', 'т', 2, 1500000, 3000000],
  ['3', 'Цемент М500', 'т', 1, 1500000, 1500000],
  ['4', 'Qum yuvilgan', 'm³', 10, 120000, 1200000],
  ['5', 'Gips plita', 'dona', 50, 30000, 1500000],
  ['6', 'Suvoq ishlari', 'm²', 100, 25000, 2500000],
  ['7', 'Bo‘yoq', 'kg', 'abc', 100, null],
  [null, 'Итого', null, null, null, 9700000],
]

function estimate(id: string, version: number, overrides: Partial<Estimate> = {}): Estimate {
  return {
    id,
    company_id: COMPANY_ID,
    object_id: 'o-a',
    version,
    title: `Smeta v${version}`,
    estimate_date: '2026-10-20',
    source_file_name: `v${version}.xlsx`,
    is_current: false,
    created_by: null,
    created_at: '2026-10-20T05:00:00Z',
    updated_at: '2026-10-20T05:00:00Z',
    item_count: 2,
    material_count: 1,
    total_sum: '3000000',
    ...overrides,
  }
}

function item(id: string, overrides: Partial<EstimateItem>): EstimateItem {
  return {
    id,
    estimate_id: 'e1',
    item_type: 'ish',
    name: 'Ish',
    material_id: null,
    unit: 'm²',
    unit_id: null,
    qty: '1',
    unit_price: '1000',
    norm_qty_base: null,
    sort_order: 1,
    code: null,
    row_number: 1,
    material_name: null,
    base_unit: null,
    ...overrides,
  }
}

const PREV_ITEMS = [
  item('i1', {
    item_type: 'material',
    name: 'Цемент М500',
    material_id: 'm-sem',
    unit: 'т',
    unit_id: 'u-t-old',
    qty: '2',
    norm_qty_base: '2000',
    unit_price: '1400000',
    material_name: 'Sement M500',
    base_unit: 'kg',
  }),
  item('i2', { name: 'Demontaj', unit: 'm²', qty: '20', unit_price: '10000' }),
]

function open(role: Role = 'admin') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/estimates'] })} />)
}

// Sahifalagichda ham "Keyingi" bor — usta tugmasi oxirgisi
const next = () => fireEvent.click(screen.getAllByRole('button', { name: tw.next }).at(-1) as HTMLElement)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue(SHEET as never)
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, qum])
  vi.mocked(materialsRepo.createMaterial).mockResolvedValue(gips)
  vi.mocked(unitsRepo.addMaterialUnit).mockResolvedValue(makeUnit('u-t', 'm-sem', 'т', '1000'))
  vi.mocked(aliasesRepo.addMaterialAlias).mockResolvedValue(makeAlias('a-new', 'm-qum', 'Qum yuvilgan', 'uz'))
  vi.mocked(estimatesRepo.listEstimates).mockResolvedValue([estimate('e1', 1, { is_current: true })])
  vi.mocked(estimatesRepo.listEstimateItems).mockResolvedValue(PREV_ITEMS)
  vi.mocked(estimatesRepo.importEstimate).mockImplementation(async (input) => input.id)
  vi.mocked(templatesRepo.findTemplateBySignature).mockResolvedValue(null)
})

/** Ustani ochib, faylni tanlaydi va 1-qadamdan o'tadi. */
async function startWizard() {
  open()
  fireEvent.click(await screen.findByRole('button', { name: te.upload }))
  const input = screen.getByLabelText(tw.file)
  fireEvent.change(input, { target: { files: [new File(['x'], 'smeta.xlsx')] } })
  await screen.findByText(tw.fileChosen('smeta.xlsx'))
  expect(screen.getByLabelText(tw.titleLabel)).toHaveValue('smeta')
  next()
}

/** 2–4 qadamlar: sarlavha avtomatik, ustunlar avtomatik, xato qator o'tkazib yuboriladi. */
async function throughRows() {
  await startWizard()
  expect(await screen.findByText(tw.headerDetected(2))).toBeInTheDocument()
  next()
  await screen.findByText(tw.autoMapped)
  next()
  const bad = await screen.findByTestId('row-9')
  expect(within(bad).getByText(/miqdor noto‘g‘ri/)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: tw.next }).at(-1)).toBeDisabled()
  fireEvent.click(within(bad).getByRole('button', { name: tw.skip }))
  next()
}

async function throughCatalog() {
  await throughRows()
  const cement = await screen.findByTestId('group-цемент м500')
  expect(within(cement).getByText(/Aniq moslik/)).toBeInTheDocument()
  fireEvent.click(within(screen.getByTestId('group-qum yuvilgan')).getByRole('button', { name: 'Qum' }))
  // Qisman moslik: muqobil nom standart o'chiq — ataylab yoqiladi
  const aliasBox = within(screen.getByTestId('group-qum yuvilgan')).getByRole('checkbox', { name: new RegExp(tw.saveAlias) })
  expect(aliasBox).not.toBeChecked()
  fireEvent.click(aliasBox)
  expect(within(screen.getByTestId('group-цемент м500')).queryByRole('checkbox')).not.toBeInTheDocument()
  fireEvent.click(within(screen.getByTestId('group-gips plita')).getByRole('button', { name: tw.newMaterial }))
  expect(screen.getAllByRole('button', { name: tw.next }).at(-1)).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: tw.allAsWork }))
  expect(within(screen.getByTestId('group-suvoq ishlari')).getByText(tw.asWorkChosen)).toBeInTheDocument()
  next()
}

describe('/estimates — import ustasi', () => {
  it('to‘liq oqim: moslash, birlik savoli bir marta, farq va saqlash argumentlari', async () => {
    vi.mocked(estimatesRepo.importEstimate).mockImplementation(async (input) => {
      vi.mocked(estimatesRepo.listEstimates).mockResolvedValue([
        estimate(input.id, 2, { is_current: true, title: input.title }),
        estimate('e1', 1),
      ])
      return input.id
    })
    await throughCatalog()

    // Birlik savoli: ikki qatorda «т», lekin bitta savol
    const questions = await screen.findAllByTestId(/^unitq-/)
    expect(questions).toHaveLength(1)
    const q = questions[0] as HTMLElement
    expect(within(q).getByText(tw.unitQuestion('т', 'Sement M500'))).toBeInTheDocument()
    fireEvent.click(within(q).getByRole('button', { name: tw.addUnit }))
    fireEvent.change(within(q).getByLabelText(t.materials.units.factor), { target: { value: '1000' } })
    expect(within(q).getByText('1 т = 1 000 kg')).toBeInTheDocument()
    next()

    // Tekshirish: jami va farq
    expect(await screen.findByTestId('review-total')).toHaveTextContent(formatSum('9700000'))
    const added = await screen.findByRole('region', { name: te.diff.added })
    expect(within(added).getByText('Qum')).toBeInTheDocument()
    expect(within(added).getByText('Gips plita')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: te.diff.removed })).getByText('Demontaj')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: te.diff.changed })).getByText('Sement M500')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: tw.newAliases })).getByText(/Qum yuvilgan/)).toBeInTheDocument()
    expect(screen.queryByText(/Fayldagi jami/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: tw.saveButton }))
    await waitFor(() => expect(estimatesRepo.importEstimate).toHaveBeenCalledTimes(1))

    expect(materialsRepo.createMaterial).toHaveBeenCalledWith({ companyId: COMPANY_ID, name: 'Gips plita', baseUnit: 'dona' })
    expect(unitsRepo.addMaterialUnit).toHaveBeenCalledTimes(1)
    expect(unitsRepo.addMaterialUnit).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      materialId: 'm-sem',
      unit: 'т',
      factor: '1000',
      variant: '',
    })
    expect(aliasesRepo.addMaterialAlias).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      materialId: 'm-qum',
      alias: 'Qum yuvilgan',
      lang: 'uz',
    })
    const input = vi.mocked(estimatesRepo.importEstimate).mock.calls[0]?.[0]
    expect(input).toMatchObject({
      objectId: 'o-a',
      title: 'smeta',
      sourceFileName: 'smeta.xlsx',
      estimateDate: null,
    })
    expect(input?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(input?.items).toEqual([
      { item_type: 'material', name: 'Цемент М500', material_id: 'm-sem', unit: 'т', unit_id: 'u-t', qty: '2', unit_price: '1500000', code: '2', row_number: 4, sort_order: 1 },
      { item_type: 'material', name: 'Цемент М500', material_id: 'm-sem', unit: 'т', unit_id: 'u-t', qty: '1', unit_price: '1500000', code: '3', row_number: 5, sort_order: 2 },
      { item_type: 'material', name: 'Qum yuvilgan', material_id: 'm-qum', unit: 'm³', unit_id: 'm-qum-base', qty: '10', unit_price: '120000', code: '4', row_number: 6, sort_order: 3 },
      { item_type: 'material', name: 'Gips plita', material_id: 'm-gips', unit: 'dona', unit_id: 'm-gips-base', qty: '50', unit_price: '30000', code: '5', row_number: 7, sort_order: 4 },
      { item_type: 'ish', name: 'Suvoq ishlari', material_id: null, unit: 'm²', unit_id: null, qty: '100', unit_price: '25000', code: '6', row_number: 8, sort_order: 5 },
    ])
    for (const it of input?.items ?? []) expect(typeof it.qty).toBe('string')

    expect(templatesRepo.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        headerSignature: '№|наименование|ед. изм.|кол-во|цена|сумма',
        mapping: { name: 1, unit: 2, qty: 3, price: 4, sum: 5, code: 0 },
        sheetName: 'Smeta',
        headerRow: 1,
      }),
    )
    // Muvaffaqiyat — saqlangan versiya sahifasi
    expect(await screen.findByRole('region', { name: 'smeta' })).toBeInTheDocument()
    await waitFor(() => expect(estimatesRepo.listEstimateItems).toHaveBeenCalledWith(input?.id))
  })

  it('orqaga qaytilganda tanlovlar yo‘qolmaydi', async () => {
    await throughCatalog()
    await screen.findAllByTestId(/^unitq-/)
    fireEvent.click(screen.getByRole('button', { name: tw.back }))
    expect(within(await screen.findByTestId('group-qum yuvilgan')).getByText('Qum', { selector: '[data-tone]' })).toBeInTheDocument()
    expect(within(screen.getByTestId('group-suvoq ishlari')).getByText(tw.asWorkChosen)).toBeInTheDocument()
  })

  it('saqlangan shablon qo‘llanadi', async () => {
    vi.mocked(templatesRepo.findTemplateBySignature).mockResolvedValue({
      id: 'tpl1',
      company_id: COMPANY_ID,
      name: 'Shablon',
      header_signature: '№|наименование|ед. изм.|кол-во|цена|сумма',
      mapping: { name: 1, unit: 2, qty: 3, sum: 5 },
      sheet_name: 'Smeta',
      header_row: 1,
      last_used_at: '2026-10-20T05:00:00Z',
      updated_at: '2026-10-20T05:00:00Z',
      created_by_name: 'Ali Admin',
    })
    await startWizard()
    await screen.findByText(tw.headerDetected(2))
    next()
    expect(await screen.findByText(tw.templateApplied)).toBeInTheDocument()
    expect(templatesRepo.findTemplateBySignature).toHaveBeenCalledWith(COMPANY_ID, '№|наименование|ед. изм.|кол-во|цена|сумма')
    expect(screen.getByLabelText(`${tw.fields.price} (${tw.optional})`)).toHaveValue('')
    expect(screen.getByLabelText(`${tw.fields.qty} (${tw.required})`)).toHaveValue('3')
    expect(screen.getByText(tw.templateInfo('Shablon', 'Ali Admin', '20.10.2026 10:00'))).toBeInTheDocument()
    // Qo'lda moslash — avtomatik taklifga qaytadi (narx ustuni topiladi), keyin shablonni qayta qo'llash
    fireEvent.click(screen.getByRole('button', { name: tw.templateManual }))
    expect(screen.getByLabelText(`${tw.fields.price} (${tw.optional})`)).toHaveValue('4')
    fireEvent.click(screen.getByRole('button', { name: tw.templateApply }))
    expect(screen.getByLabelText(`${tw.fields.price} (${tw.optional})`)).toHaveValue('')
  })

  it('server estimate_item_invalid xabari ko‘rsatiladi; qayta urinishda yaratilganlar takrorlanmaydi', async () => {
    vi.mocked(estimatesRepo.importEstimate).mockRejectedValueOnce(
      toRepoError({ code: '22023', hint: 'estimate_item_invalid', message: 'Qator 4: birlik materialga tegishli emas' }),
    )
    await throughCatalog()
    const q = (await screen.findAllByTestId(/^unitq-/))[0] as HTMLElement
    fireEvent.click(within(q).getByRole('button', { name: 'qop' }))
    next()
    fireEvent.click(await screen.findByRole('button', { name: tw.saveButton }))
    expect(await screen.findByText('Qator 4: birlik materialga tegishli emas')).toBeInTheDocument()
    const firstId = vi.mocked(estimatesRepo.importEstimate).mock.calls[0]?.[0].id

    fireEvent.click(screen.getByRole('button', { name: tw.retry }))
    await waitFor(() => expect(estimatesRepo.importEstimate).toHaveBeenCalledTimes(2))
    expect(vi.mocked(estimatesRepo.importEstimate).mock.calls[1]?.[0].id).toBe(firstId)
    expect(materialsRepo.createMaterial).toHaveBeenCalledTimes(1)
    expect(aliasesRepo.addMaterialAlias).toHaveBeenCalledTimes(1)
    expect(unitsRepo.addMaterialUnit).not.toHaveBeenCalled()
    expect(vi.mocked(estimatesRepo.importEstimate).mock.calls[1]?.[0].items[0]).toMatchObject({ unit_id: 'u-qop', qty: '2' })
  })

  it('buxgalter: yangi material va muqobil nom tugmalari yo‘q', async () => {
    open('buxgalter')
    fireEvent.click(await screen.findByRole('button', { name: te.upload }))
    fireEvent.change(screen.getByLabelText(tw.file), { target: { files: [new File(['x'], 'smeta.xlsx')] } })
    await screen.findByText(tw.fileChosen('smeta.xlsx'))
    next()
    await screen.findByText(tw.headerDetected(2))
    next()
    next()
    fireEvent.click(within(await screen.findByTestId('row-9')).getByRole('button', { name: tw.skip }))
    next()
    await screen.findByTestId('group-gips plita')
    expect(screen.getByText(tw.catalogAdminOnly)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: tw.newMaterial })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('group-qum yuvilgan')).getByRole('button', { name: 'Qum' }))
    expect(screen.queryByRole('checkbox', { name: new RegExp(tw.saveAlias) })).not.toBeInTheDocument()
  })

  it('estimate_id_reused: yangi id bilan qayta saqlash mumkin', async () => {
    vi.mocked(estimatesRepo.importEstimate).mockRejectedValueOnce(
      toRepoError({ code: '23505', hint: 'estimate_id_reused', message: 'x' }),
    )
    await throughCatalog()
    const q = (await screen.findAllByTestId(/^unitq-/))[0] as HTMLElement
    fireEvent.click(within(q).getByRole('button', { name: 'qop' }))
    next()
    fireEvent.click(await screen.findByRole('button', { name: tw.saveButton }))
    expect(await screen.findByText(t.errors.estimate_id_reused)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: tw.retry })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tw.newId }))
    fireEvent.click(await screen.findByRole('button', { name: tw.saveButton }))
    await waitFor(() => expect(estimatesRepo.importEstimate).toHaveBeenCalledTimes(2))
    const [a, b] = vi.mocked(estimatesRepo.importEstimate).mock.calls.map((c) => c[0].id)
    expect(a).not.toBe(b)
    expect(materialsRepo.createMaterial).toHaveBeenCalledTimes(1)
  })

  it('yashirin qator standart o‘tkaziladi, qaytarish mumkin', async () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({
      SheetNames: ['Smeta'],
      Sheets: { Smeta: { '!rows': [undefined, undefined, undefined, undefined, undefined, undefined, { hidden: true }] } },
    } as never)
    await throughRows()
    expect(await screen.findByTestId('group-цемент м500')).toBeInTheDocument()
    expect(screen.queryByTestId('group-gips plita')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tw.back }))
    const hiddenRow = await screen.findByTestId('row-7')
    expect(within(hiddenRow).getByText(tw.hidden)).toBeInTheDocument()
    fireEvent.click(within(hiddenRow).getByRole('button', { name: tw.unskip }))
    next()
    expect(await screen.findByTestId('group-gips plita')).toBeInTheDocument()
  })

  it('5000 dan ortiq qator — tekshirish bosqichida xato, saqlash yo‘q', async () => {
    const big = [SHEET[1], ...Array.from({ length: 5001 }, (_, i) => [String(i + 1), 'Suvoq ishlari', 'm²', 1, 10, 10])]
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue(big as never)
    await startWizard()
    await screen.findByText(tw.headerDetected(1))
    next()
    next()
    next()
    fireEvent.click(await screen.findByRole('button', { name: tw.allAsWork }))
    next()
    next()
    expect(await screen.findByText(tw.tooManyRows(5001, 5000))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: tw.saveButton })).toBeDisabled()
  })

  it('smeta sanasi oraliqdan tashqarida — keyingi qadam yo‘q', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: te.upload }))
    fireEvent.change(screen.getByLabelText(tw.file), { target: { files: [new File(['x'], 'smeta.xlsx')] } })
    await screen.findByText(tw.fileChosen('smeta.xlsx'))
    fireEvent.change(screen.getByLabelText(tw.dateLabel), { target: { value: '1999-12-31' } })
    expect(screen.getByText(tw.dateInvalid)).toBeInTheDocument()
    next()
    expect(screen.queryByText(tw.headerDetected(2))).not.toBeInTheDocument()
  })

  it('noto‘g‘ri fayl turi rad etiladi', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: te.upload }))
    fireEvent.change(screen.getByLabelText(tw.file), { target: { files: [new File(['x'], 'smeta.pdf')] } })
    expect(await screen.findByText(tw.fileErrors.file_type)).toBeInTheDocument()
    expect(XLSX.read).not.toHaveBeenCalled()
  })
})

describe('/estimates — versiyalar', () => {
  beforeEach(() => {
    vi.mocked(estimatesRepo.listEstimates).mockResolvedValue([
      estimate('e2', 2, { is_current: true, total_sum: '5000000' }),
      estimate('e1', 1),
    ])
  })

  it('direktor: faqat ko‘rish — yuklash va joriy qilish tugmalari yo‘q', async () => {
    open('direktor')
    expect(await screen.findAllByTestId('estimate-version')).toHaveLength(2)
    expect(screen.getByText(te.readOnly)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: te.upload })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: te.makeCurrent })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: te.open })[1] as HTMLElement)
    expect(await screen.findAllByTestId('estimate-item')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: te.makeCurrent })).not.toBeInTheDocument()
  })

  it('admin: joriy qilish — tasdiqlash oynasida farq va ogohlantirish', async () => {
    vi.mocked(estimatesRepo.listEstimateItems).mockImplementation(async (id) =>
      id === 'e1' ? PREV_ITEMS : [{ ...(PREV_ITEMS[0] as EstimateItem), qty: '3', norm_qty_base: '3000' }],
    )
    open('admin')
    await screen.findAllByTestId('estimate-version')
    fireEvent.click(screen.getByRole('button', { name: te.makeCurrent }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(te.makeCurrentWarn)).toBeInTheDocument()
    expect(within(await dialog.findByRole('region', { name: te.diff.added })).getByText('Demontaj')).toBeInTheDocument()
    expect(estimatesRepo.setCurrentEstimate).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: te.makeCurrentConfirm }))
    await waitFor(() => expect(estimatesRepo.setCurrentEstimate).toHaveBeenCalledWith('e1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('ikki versiyani solishtirish', async () => {
    vi.mocked(estimatesRepo.listEstimateItems).mockImplementation(async (id) =>
      id === 'e1' ? PREV_ITEMS : [{ ...(PREV_ITEMS[0] as EstimateItem), qty: '3', norm_qty_base: '3000' }],
    )
    open('direktor')
    await screen.findAllByTestId('estimate-version')
    fireEvent.click(screen.getByRole('button', { name: te.compare }))
    const changed = await screen.findByRole('region', { name: te.diff.changed })
    expect(within(changed).getByText('Sement M500')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: te.diff.removed })).getByText('Demontaj')).toBeInTheDocument()
  })
})
