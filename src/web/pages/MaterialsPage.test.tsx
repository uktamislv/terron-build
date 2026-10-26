import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import { toRepoError } from '@/data/errors'
import * as materialsRepo from '@/data/materialsRepo'
import * as unitsRepo from '@/data/materialUnitsRepo'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeAlias, makeMaterial, makeProfile, makeUnit } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u-admin', email: 'admin@firma.uz' })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 10,
}))

vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  softDeleteMaterial: vi.fn(),
}))
vi.mock('@/data/materialUnitsRepo', () => ({
  addMaterialUnit: vi.fn(),
  updateMaterialUnit: vi.fn(),
  softDeleteMaterialUnit: vi.fn(),
}))
vi.mock('@/data/materialAliasesRepo', () => ({
  addMaterialAlias: vi.fn(),
  softDeleteMaterialAlias: vi.fn(),
}))

const tm = t.materials

const sement = makeMaterial('m-sem', 'Sement M500', 'kg', {
  category: 'Bog‘lovchi',
  units: [makeUnit('u-qop', 'm-sem', 'qop', '50.0000000000')],
  aliases: [makeAlias('a1', 'm-sem', 'Цемент М500')],
})
const qum = makeMaterial('m-qum', 'Qum', 'm³', {
  category: 'Inert',
  waste_pct: '2.50',
  units: [makeUnit('u-t', 'm-qum', 'tonna', '0.6667000000')],
  aliases: [makeAlias('a2', 'm-qum', 'Песок')],
})
const kafel = makeMaterial('m-kaf', 'Kafel', 'm²', { is_active: false })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('admin'))
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([qum, sement, kafel])
})

function renderPage() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/materials'] })} />)
}

function list() {
  return within(screen.getByRole('list', { name: tm.title }))
}

async function openMaterial(name: string) {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
  return within(await screen.findByRole('dialog'))
}

describe('/materials — ro‘yxat va qidiruv', () => {
  it('faol materiallar ko‘rsatiladi: asosiy birlik, isrof, birliklar soni', async () => {
    renderPage()
    expect(await screen.findByText('Sement M500')).toBeInTheDocument()
    expect(list().getByText('Qum')).toBeInTheDocument()
    expect(list().queryByText('Kafel')).not.toBeInTheDocument()
    // Meta alohida bo'laklarda (belgi + matn): asosiy birlik, isrof, birliklar soni
    const qum = within(list().getByRole('button', { name: /Qum/ }))
    expect(qum.getByText('m³')).toBeInTheDocument()
    expect(qum.getByText(`${tm.wasteShort} 2,5%`)).toBeInTheDocument()
    expect(qum.getByText(`2 ${tm.unitsCount}`)).toBeInTheDocument()
  })

  it('muqobil nom bo‘yicha topadi (katta-kichik harfga qaramay)', async () => {
    renderPage()
    await screen.findByText('Sement M500')
    fireEvent.change(screen.getByLabelText(tm.search), { target: { value: '  песок ' } })
    expect(list().getByText('Qum')).toBeInTheDocument()
    expect(list().queryByText('Sement M500')).not.toBeInTheDocument()
  })

  it('topilmasa — xabar; nofaol filtri; kategoriya filtri', async () => {
    renderPage()
    await screen.findByText('Sement M500')
    fireEvent.change(screen.getByLabelText(tm.search), { target: { value: 'yo‘q narsa' } })
    expect(screen.getByText(tm.notFound)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(tm.search), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: tm.filters.inactive }))
    expect(list().getByText('Kafel')).toBeInTheDocument()
    expect(list().queryByText('Qum')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tm.filters.all }))
    fireEvent.change(screen.getByLabelText(tm.category), { target: { value: 'Inert' } })
    expect(list().getAllByRole('listitem')).toHaveLength(1)
    expect(list().getByText('Qum')).toBeInTheDocument()
  })
})

describe('/materials — birliklar', () => {
  it('koeffitsient jonli tekshiriladi va "1 qop = 50 kg" ko‘rinadi', async () => {
    vi.mocked(unitsRepo.addMaterialUnit).mockResolvedValue(makeUnit('u-new', 'm-kg', 'qop', '50'))
    const kgOnly = makeMaterial('m-kg', 'Gips', 'kg')
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([kgOnly])
    const dialog = await openMaterial('Gips')
    fireEvent.click(dialog.getByRole('button', { name: tm.units.add }))
    const form = within(dialog.getByRole('form', { name: tm.units.addTitle }))
    fireEvent.change(form.getByLabelText(tm.units.unit), { target: { value: 'qop' } })

    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: 'abc' } })
    expect(form.getByText(tm.units.factorErrors.not_number)).toBeInTheDocument()
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '0' } })
    expect(form.getByText(tm.units.factorErrors.not_positive)).toBeInTheDocument()
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '0,00000000001' } })
    expect(form.getByText(tm.units.factorErrors.too_precise)).toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(unitsRepo.addMaterialUnit).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '50' } })
    expect(form.getByRole('status')).toHaveTextContent('1 qop = 50 kg')
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(unitsRepo.addMaterialUnit).toHaveBeenCalledWith({
        companyId: kgOnly.company_id,
        materialId: 'm-kg',
        unit: 'qop',
        factor: '50',
        variant: '',
      }),
    )
  })

  it('asosiy birlik nomini variantsiz qayta qo‘shib bo‘lmaydi', async () => {
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(dialog.getByRole('button', { name: tm.units.add }))
    const form = within(dialog.getByRole('form', { name: tm.units.addTitle }))
    fireEvent.change(form.getByLabelText(tm.units.unit), { target: { value: 'kg' } })
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '1' } })
    expect(form.getByText(tm.units.errSameAsBase)).toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(unitsRepo.addMaterialUnit).not.toHaveBeenCalled()
  })

  it('asosiy birlik qatori belgilangan va tahrirlab/o‘chirib bo‘lmaydi', async () => {
    const dialog = await openMaterial('Sement M500')
    const baseRow = within(dialog.getByTestId('unit-m-sem-base'))
    expect(baseRow.getByText(tm.units.base)).toBeInTheDocument()
    expect(baseRow.queryByRole('button')).not.toBeInTheDocument()
    const qopRow = within(dialog.getByTestId('unit-u-qop'))
    expect(qopRow.getByText('1 qop = 50 kg')).toBeInTheDocument()
    expect(qopRow.getByRole('button', { name: t.common.edit })).toBeInTheDocument()
    expect(qopRow.getByRole('button', { name: tm.delete })).toBeInTheDocument()
  })

  it('birlik nomi normallashtirib solishtiriladi: " KG " = asosiy birlik', async () => {
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(dialog.getByRole('button', { name: tm.units.add }))
    const form = within(dialog.getByRole('form', { name: tm.units.addTitle }))
    fireEvent.change(form.getByLabelText(tm.units.unit), { target: { value: ' KG ' } })
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '1' } })
    expect(form.getByText(tm.units.errSameAsBase)).toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(unitsRepo.addMaterialUnit).not.toHaveBeenCalled()
  })

  it('dublikat birlik ("QOP") — oldindan xato; variant bilan — ruxsat', async () => {
    vi.mocked(unitsRepo.addMaterialUnit).mockResolvedValue(makeUnit('u-new', 'm-sem', 'qop', '25', 'kichik'))
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(dialog.getByRole('button', { name: tm.units.add }))
    const form = within(dialog.getByRole('form', { name: tm.units.addTitle }))
    fireEvent.change(form.getByLabelText(tm.units.unit), { target: { value: 'QOP' } })
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '25' } })
    expect(form.getByText(tm.units.errDuplicate)).toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(unitsRepo.addMaterialUnit).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText(tm.units.variant), { target: { value: 'kichik' } })
    expect(form.queryByText(tm.units.errDuplicate)).not.toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(unitsRepo.addMaterialUnit).toHaveBeenCalled())
  })

  it('o‘z qatorini tahrirlashda dublikat deb hisoblanmaydi', async () => {
    vi.mocked(unitsRepo.updateMaterialUnit).mockResolvedValue(makeUnit('u-qop', 'm-sem', 'Qop', '50'))
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(within(dialog.getByTestId('unit-u-qop')).getByRole('button', { name: t.common.edit }))
    const form = within(dialog.getByRole('form', { name: tm.units.editTitle }))
    fireEvent.change(form.getByLabelText(tm.units.unit), { target: { value: 'Qop' } })
    expect(form.queryByText(tm.units.errDuplicate)).not.toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(unitsRepo.updateMaterialUnit).toHaveBeenCalledWith('u-qop', { unit: 'Qop', factor: '50', variant: '' }),
    )
  })

  it('hint’siz server xatosi — server matni emas, umumiy i18n matni', async () => {
    const msg = 'Bu birlik harakatlarda ishlatilgan — koeffitsientni o‘zgartirib bo‘lmaydi.'
    vi.mocked(unitsRepo.updateMaterialUnit).mockRejectedValue(toRepoError({ code: 'P0001', message: msg }))
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(within(dialog.getByTestId('unit-u-qop')).getByRole('button', { name: t.common.edit }))
    const form = within(dialog.getByRole('form', { name: tm.units.editTitle }))
    expect(form.getByLabelText(tm.units.factor)).toHaveValue('50')
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '40' } })
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(await form.findByText(t.errors.invalid_value)).toBeInTheDocument()
    expect(form.queryByText(msg)).not.toBeInTheDocument()
    expect(unitsRepo.updateMaterialUnit).toHaveBeenCalledWith('u-qop', { unit: 'qop', factor: '40', variant: '' })
  })
})

describe('/materials — nom va muqobil nom dublikati (oldindan)', () => {
  it('muqobil nom boshqa materialning muqobil nomi yoki nomi bilan bir xil — xato, repo chaqirilmaydi', async () => {
    const aliasesRepo = await import('@/data/materialAliasesRepo')
    const dialog = await openMaterial('Sement M500')
    const section = within(dialog.getByRole('region', { name: tm.aliases.title }))
    fireEvent.change(section.getByLabelText(tm.aliases.alias), { target: { value: '  ПЕСОК ' } })
    fireEvent.click(section.getByRole('button', { name: tm.aliases.add }))
    expect(section.getByText(tm.aliases.errTaken)).toBeInTheDocument()
    fireEvent.change(section.getByLabelText(tm.aliases.alias), { target: { value: 'qum' } })
    fireEvent.click(section.getByRole('button', { name: tm.aliases.add }))
    expect(section.getByText(tm.aliases.errTaken)).toBeInTheDocument()
    expect(aliasesRepo.addMaterialAlias).not.toHaveBeenCalled()

    vi.mocked(aliasesRepo.addMaterialAlias).mockResolvedValue(makeAlias('a9', 'm-sem', 'Портландцемент'))
    fireEvent.change(section.getByLabelText(tm.aliases.alias), { target: { value: 'Портландцемент' } })
    fireEvent.click(section.getByRole('button', { name: tm.aliases.add }))
    await waitFor(() =>
      expect(aliasesRepo.addMaterialAlias).toHaveBeenCalledWith({
        companyId: sement.company_id,
        materialId: 'm-sem',
        alias: 'Портландцемент',
        lang: 'ru',
      }),
    )
  })

  it('yangi material nomi boshqa material nomi yoki muqobil nomi bilan bir xil — xato', async () => {
    renderPage()
    await screen.findByText('Sement M500')
    fireEvent.click(screen.getByRole('button', { name: tm.add }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'kg' }))
    fireEvent.change(dialog.getByLabelText(tm.name), { target: { value: ' QUM ' } })
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(dialog.getByText(tm.errNameTaken)).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText(tm.name), { target: { value: 'цемент   м500' } })
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(dialog.getByText(tm.errNameTaken)).toBeInTheDocument()
    expect(materialsRepo.createMaterial).not.toHaveBeenCalled()
  })

  it('tahrirlashda o‘z nomi band deb hisoblanmaydi', async () => {
    vi.mocked(materialsRepo.updateMaterial).mockResolvedValue(undefined)
    const dialog = await openMaterial('Qum')
    fireEvent.click(dialog.getAllByRole('button', { name: t.common.edit })[0] as HTMLElement)
    const form = within(await screen.findByRole('dialog', { name: tm.editTitle }))
    fireEvent.change(form.getByLabelText(tm.name), { target: { value: 'QUM' } })
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(materialsRepo.updateMaterial).toHaveBeenCalled())
  })
})

describe('/materials — katalog himoyalari (hint kalitlari)', () => {
  const guard = (hint: string) => toRepoError({ code: 'P0001', hint, message: 'server' })

  it('qoldig‘i bor material: obyekt nomi bilan (uz.ts shabloni), "Nofaol qilish" taklif qilinadi', async () => {
    // Server xabari (migratsiyadagi matn); foydalanuvchiga — faqat obyekt nomi, uz.ts shablonida
    const msg = `Materialni o'chirib bo'lmaydi: "Chilonzor 5" obyektida qoldig'i bor. Uni nofaol qiling.`
    vi.mocked(materialsRepo.softDeleteMaterial).mockRejectedValue(
      toRepoError({ code: 'P0001', hint: 'catalog_material_has_stock', message: msg }),
    )
    vi.mocked(materialsRepo.updateMaterial).mockResolvedValue(undefined)
    const dialog = await openMaterial('Qum')
    fireEvent.click(dialog.getAllByRole('button', { name: tm.delete })[0] as HTMLElement)
    fireEvent.click(dialog.getByRole('button', { name: t.common.yes }))
    const alert = within(await dialog.findByRole('alert'))
    expect(alert.getByText(t.errorsWith.catalog_material_has_stock('Chilonzor 5'))).toBeInTheDocument()
    fireEvent.click(alert.getByRole('button', { name: tm.makeInactive }))
    await waitFor(() => expect(materialsRepo.updateMaterial).toHaveBeenCalledWith('m-qum', { isActive: false }))
    await waitFor(() => expect(materialsRepo.listMaterials).toHaveBeenCalledTimes(2))
  })

  it('ishlatilgan birlik: tushunarli xabar va "Birlik qo‘shish" yo‘li', async () => {
    vi.mocked(unitsRepo.updateMaterialUnit).mockRejectedValue(guard('catalog_unit_in_use'))
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(within(dialog.getByTestId('unit-u-qop')).getByRole('button', { name: t.common.edit }))
    const form = within(dialog.getByRole('form', { name: tm.units.editTitle }))
    fireEvent.change(form.getByLabelText(tm.units.factor), { target: { value: '40' } })
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(await form.findByText(t.errors.catalog_unit_in_use)).toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: tm.units.add }))
    expect(dialog.getByRole('form', { name: tm.units.addTitle })).toBeInTheDocument()
    expect(dialog.queryByRole('form', { name: tm.units.editTitle })).not.toBeInTheDocument()
  })

  it('asosiy birlik ishlatilgan bo‘lsa — xabar; ishlatilmagan bo‘lsa — saqlanadi va ro‘yxat qayta yuklanadi', async () => {
    vi.mocked(materialsRepo.updateMaterial).mockRejectedValueOnce(guard('catalog_base_unit_in_use'))
    const dialog = await openMaterial('Sement M500')
    fireEvent.click(dialog.getAllByRole('button', { name: t.common.edit })[0] as HTMLElement)
    const form = within(await screen.findByRole('dialog', { name: tm.editTitle }))
    fireEvent.click(form.getByRole('button', { name: 't' }))
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    expect(await form.findByText(t.errors.catalog_base_unit_in_use)).toBeInTheDocument()

    vi.mocked(materialsRepo.updateMaterial).mockResolvedValueOnce(undefined)
    fireEvent.click(form.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(materialsRepo.updateMaterial).toHaveBeenLastCalledWith('m-sem', {
        name: 'Sement M500',
        baseUnit: 't',
        category: 'Bog‘lovchi',
        wastePct: '0',
        photoRequired: false,
      }),
    )
    await waitFor(() => expect(materialsRepo.listMaterials).toHaveBeenCalledTimes(2))
  })
})

describe('/materials — kalkulyator', () => {
  function calc(dialog: ReturnType<typeof within>) {
    return within(dialog.getByRole('region', { name: tm.calc.title }))
  }

  it('3 qop sement → 150 kg', async () => {
    const dialog = await openMaterial('Sement M500')
    const c = calc(dialog)
    fireEvent.change(c.getByLabelText(tm.calc.qty), { target: { value: '3' } })
    fireEvent.click(c.getByRole('button', { name: 'qop' }))
    expect(c.getByLabelText(tm.calc.result)).toHaveTextContent('150 kg')
  })

  it('1,5 t qum → 1,00005 m³ (bazadagi yaxlitlash bilan)', async () => {
    const dialog = await openMaterial('Qum')
    const c = calc(dialog)
    fireEvent.change(c.getByLabelText(tm.calc.qty), { target: { value: '1,5' } })
    fireEvent.click(c.getByRole('button', { name: 'tonna' }))
    expect(c.getByLabelText(tm.calc.result)).toHaveTextContent('1,00005 m³')
  })

  it('noto‘g‘ri miqdor — xato, natija yo‘q', async () => {
    const dialog = await openMaterial('Qum')
    const c = calc(dialog)
    fireEvent.change(c.getByLabelText(tm.calc.qty), { target: { value: '1,5,5' } })
    expect(c.getByText(tm.calc.errQty)).toBeInTheDocument()
    expect(c.getByLabelText(tm.calc.result)).toHaveTextContent('—')
  })
})

describe('/materials — faqat ko‘rish roli', () => {
  it('taminotchi: tahrir tugmalari yo‘q, kalkulyator bor', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('taminotchi'))
    const dialog = await openMaterial('Sement M500')
    expect(screen.queryByRole('button', { name: tm.add })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: t.common.edit })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: tm.delete })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: tm.units.add })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: tm.aliases.add })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: tm.makeInactive })).not.toBeInTheDocument()
    expect(dialog.getByText('Цемент М500')).toBeInTheDocument()
    expect(dialog.getByRole('region', { name: tm.calc.title })).toBeInTheDocument()
  })
})

describe('/materials — yangi material', () => {
  it('asosiy birlik tez tanlash tugmasi bilan; isrof tekshiriladi', async () => {
    vi.mocked(materialsRepo.createMaterial).mockResolvedValue(makeMaterial('m-new', 'Gips', 'qop'))
    renderPage()
    await screen.findByText('Sement M500')
    fireEvent.click(screen.getByRole('button', { name: tm.add }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(dialog.getByText(tm.errName)).toBeInTheDocument()
    expect(dialog.getByText(tm.errBaseUnit)).toBeInTheDocument()

    fireEvent.change(dialog.getByLabelText(tm.name), { target: { value: 'Gips' } })
    fireEvent.click(dialog.getByRole('button', { name: 'qop' }))
    fireEvent.change(dialog.getByLabelText(tm.wastePct), { target: { value: '150' } })
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(dialog.getByText(tm.errWaste)).toBeInTheDocument()
    expect(materialsRepo.createMaterial).not.toHaveBeenCalled()

    fireEvent.change(dialog.getByLabelText(tm.wastePct), { target: { value: '1,5' } })
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(materialsRepo.createMaterial).toHaveBeenCalledWith({
        companyId: sement.company_id,
        name: 'Gips',
        baseUnit: 'qop',
        category: '',
        wastePct: '1.5',
        photoRequired: false,
      }),
    )
  })
})
