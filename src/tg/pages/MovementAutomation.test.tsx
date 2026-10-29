// Batch 12 — kirim/chiqim ekranidagi avtomatlashtirish: takroriy yozuv (C), rasm xeshi (C),
// joylashuv (D), "Shu yerni obyekt joyi qilish" (D), rasm majburiy (E), oxirgi miqdor (L).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as functions from '@/data/functions'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as photosRepo from '@/data/photosRepo'
import type { Movement } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { rememberLastEntry } from '@/tg/entry/lastEntry'
import { makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

const tg = vi.hoisted(() => ({ app: null as null | Record<string, unknown> }))

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1', email: null, mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(async () => 'ok'),
  clearLocalSession: vi.fn(async () => undefined),
}))
vi.mock('@/tg/telegram', () => ({
  isInsideTelegram: () => true,
  getWebApp: () => tg.app,
  getInitData: () => 'init',
  requestContact: vi.fn(),
  botLink: () => 'https://t.me/x',
  initTelegram: vi.fn(),
  stripLaunchParamsFromUrl: vi.fn(),
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(), setObjectLocation: vi.fn() }))
vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({ createMovement: vi.fn(), listMyMovements: vi.fn(async () => []) }))
vi.mock('@/data/functions', () => ({ requestPhotoHash: vi.fn(async () => null), invokeFunction: vi.fn() }))
vi.mock('@/data/companiesRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(async () => {
    const { DEFAULT_COMPANY_SETTINGS } = await importOriginal<typeof import('@/data/companiesRepo')>()
    return DEFAULT_COMPANY_SETTINGS
  }),
}))
vi.mock('@/data/openPurchasesRepo', () => ({ listOpenPurchases: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({ listIncomingTransfers: vi.fn(async () => []) }))
vi.mock('@/data/stockRepo', () => ({ getStock: vi.fn(async () => '420') }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/photosRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosRepo')>()),
  uploadPhoto: vi.fn(async () => 'c/2026/10/abc.jpg'),
}))

const tm = t.tg.movement
const ta = t.tg.auto

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50.0000000000')] })
const kafel = makeMaterial('m-kaf', 'Kafel', 'm²', { photo_required: true })
const objA = makeObject('o-a', 'Obyekt A')

function saved(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'mv-old',
    company_id: 'c',
    type: 'kirim',
    object_id: 'o-a',
    material_id: 'm-sem',
    unit_id: 'u-qop',
    qty_input: '3',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '150',
    purchase_id: null,
    photo_path: null,
    occurred_at: new Date().toISOString(),
    note: null,
    created_by: 'p-prorab',
    created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    created_by_name: 'Test prorab',
    ...overrides,
  }
}

const main = vi.hoisted(() => ({ click: null as null | (() => void) }))

/** Telegram MainButton/BackButton soxtasi: MainButton bosilishi `pressMain()` bilan. */
function buttons() {
  const mainButton: Record<string, unknown> = {}
  for (const m of ['setText', 'show', 'hide', 'enable', 'disable', 'showProgress', 'hideProgress', 'setParams']) {
    mainButton[m] = vi.fn(() => mainButton)
  }
  mainButton.onClick = vi.fn((cb: () => void) => {
    main.click = cb
    return mainButton
  })
  mainButton.offClick = vi.fn(() => mainButton)
  return {
    MainButton: mainButton,
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
  }
}

function pressMain() {
  if (!main.click) throw new Error('MainButton ulanmagan')
  main.click()
}

/** Telegram LocationManager soxtasi. */
function locationApp(data: { latitude: number; longitude: number; horizontal_accuracy: number } | null, denied = false) {
  return {
    ...buttons(),
    LocationManager: {
      isInited: true,
      isLocationAvailable: true,
      isAccessRequested: denied,
      isAccessGranted: !denied,
      init: (cb: () => void) => cb(),
      getLocation: (cb: (d: unknown) => void) => cb(data),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  tg.app = null
  main.click = null
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, kafel])
  vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([])
  vi.mocked(movementsRepo.createMovement).mockResolvedValue(saved({ id: 'mv-new' }))
})

function open() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/tg/movement'] })} />)
}

async function pickMaterial(name: string) {
  const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
  fireEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}

function typeQty(value: string) {
  fireEvent.change(screen.getByLabelText(tm.qty), { target: { value } })
}

function chooseUnit(name: string) {
  fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name }))
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: tm.save }))
}

describe('Batch 12 (C) — takroriy yozuv', () => {
  it('10 daqiqa ichida xuddi shunday kirim — ogohlantirish; "Baribir saqlash" bilan saqlanadi', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([saved()])
    open()
    await pickMaterial('Sement')
    typeQty('3')
    chooseUnit('qop')
    save()
    const warning = await screen.findByTestId('duplicate-warning')
    expect(warning).toHaveTextContent(ta.duplicateText(10))
    expect(movementsRepo.createMovement).not.toHaveBeenCalled()
    fireEvent.click(within(warning).getByRole('button', { name: ta.duplicateSave }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
  })

  it('miqdor boshqa bo‘lsa — ogohlantirishsiz saqlanadi', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([saved()])
    open()
    await pickMaterial('Sement')
    typeQty('4')
    chooseUnit('qop')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('duplicate-warning')).not.toBeInTheDocument()
  })

  it('chiqim — kirim bilan takror hisoblanmaydi (tur ham solishtiriladi)', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([saved()])
    open()
    fireEvent.click(await screen.findByRole('button', { name: t.movements.types.chiqim }))
    await pickMaterial('Sement')
    typeQty('3')
    chooseUnit('qop')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
  })

  it('"Bekor qilish" — ogohlantirish yopiladi, saqlanmaydi', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([saved()])
    open()
    await pickMaterial('Sement')
    typeQty('3')
    chooseUnit('qop')
    save()
    fireEvent.click(within(await screen.findByTestId('duplicate-warning')).getByRole('button', { name: ta.duplicateCancel }))
    expect(screen.queryByTestId('duplicate-warning')).not.toBeInTheDocument()
    expect(movementsRepo.createMovement).not.toHaveBeenCalled()
  })

  it('rasm tanlansa — klient xeshi yuborilmaydi; saqlangandan keyin photo-hash (fonda) chaqiriladi', async () => {
    open()
    await pickMaterial('Sement')
    typeQty('2')
    fireEvent.change(screen.getByLabelText(tm.takePhoto), {
      target: { files: [new File(['xyz'], 'a.jpg', { type: 'image/jpeg' })] },
    })
    expect(await screen.findByText('a.jpg')).toBeInTheDocument()
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    const arg = vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]
    expect(arg?.photoPath).toBe('c/2026/10/abc.jpg')
    expect(arg).not.toHaveProperty('photoSha256')
    expect(photosRepo.uploadPhoto).toHaveBeenCalled()
    await waitFor(() => expect(functions.requestPhotoHash).toHaveBeenCalledWith('movements', 'mv-new'))
  })
})

describe('Batch 12 (D) — joylashuv', () => {
  it('Telegram LocationManager — koordinata, aniqlik va `ok` yuboriladi', async () => {
    tg.app = locationApp({ latitude: 41.3110812, longitude: 69.2405624, horizontal_accuracy: 12.4 })
    open()
    await pickMaterial('Sement')
    typeQty('2')
    await waitFor(() => expect(main.click).not.toBeNull())
    pressMain()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].geo).toEqual({
      status: 'ok',
      lat: '41.311081',
      lng: '69.240562',
      accuracyM: 12,
    })
  })

  it('joylashuv ekran ochilishi bilan so‘raladi (material tanlashdan oldin)', async () => {
    const app = locationApp({ latitude: 41.3, longitude: 69.2, horizontal_accuracy: 5 })
    const spy = vi.spyOn(app.LocationManager, 'getLocation')
    tg.app = app
    open()
    await screen.findByRole('region', { name: tm.chooseMaterial })
    expect(spy).toHaveBeenCalled()
  })

  it('ruxsat berilmagan — `denied`, saqlash to‘xtamaydi', async () => {
    tg.app = locationApp(null, true)
    open()
    await pickMaterial('Sement')
    typeQty('2')
    await waitFor(() => expect(main.click).not.toBeNull())
    pressMain()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].geo).toEqual({ status: 'denied' })
  })

  it('prorab "Shu yerni obyekt joyi qilish" ni ko‘rmaydi', async () => {
    open()
    await pickMaterial('Sement')
    expect(screen.queryByRole('button', { name: ta.setObjectLocation })).not.toBeInTheDocument()
  })

  it('admin — joriy joyni obyekt koordinatasi qiladi', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('admin'))
    vi.mocked(objectsRepo.setObjectLocation).mockResolvedValue({ ...objA, lat: '41.311081', lng: '69.240562' })
    tg.app = locationApp({ latitude: 41.3110812, longitude: 69.2405624, horizontal_accuracy: 8 })
    open()
    await pickMaterial('Sement')
    fireEvent.click(screen.getByRole('button', { name: ta.setObjectLocation }))
    expect(await screen.findByText(ta.objectLocationSaved('8'))).toBeInTheDocument()
    expect(objectsRepo.setObjectLocation).toHaveBeenCalledWith('o-a', '41.311081', '69.240562')
  })
})

describe('Batch 12 (E) — rasm majburiy', () => {
  it('kirimda "rasm majburiy" material — belgi, sabab; Saqlash faol, lekin rasmsiz saqlamaydi (rasm maydoniga aylantiradi)', async () => {
    open()
    await pickMaterial('Kafel')
    typeQty('5')
    expect(screen.getByTestId('photo-required')).toBeInTheDocument()
    expect(screen.getByText(ta.photoRequiredMaterial)).toBeInTheDocument()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    expect(screen.getByRole('button', { name: tm.save })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    expect(movementsRepo.createMovement).not.toHaveBeenCalled()
    expect(scroll.mock.contexts[0]).toHaveAttribute('data-photo-field')
    fireEvent.change(screen.getByLabelText(tm.takePhoto), {
      target: { files: [new File(['x'], 'k.jpg', { type: 'image/jpeg' })] },
    })
    expect(await screen.findByText('k.jpg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: tm.save })).toBeEnabled()
  })

  it('chiqimda majburiy emas', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: t.movements.types.chiqim }))
    await pickMaterial('Kafel')
    expect(screen.queryByTestId('photo-required')).not.toBeInTheDocument()
  })
})

describe('Batch 12 (L) — oxirgi birlik va miqdor', () => {
  it('birlik oldindan tanlanadi, miqdor — faqat chip (avtomatik yozilmaydi)', async () => {
    rememberLastEntry('p-prorab', 'm-sem', 'u-qop', '3')
    open()
    await pickMaterial('Sement')
    const units = screen.getByRole('group', { name: tm.unit })
    expect(within(units).getByRole('button', { name: 'qop' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(tm.qty)).toHaveValue('')
    fireEvent.click(screen.getByTestId('last-qty'))
    expect(screen.getByLabelText(tm.qty)).toHaveValue('3')
    expect(screen.queryByTestId('last-qty')).not.toBeInTheDocument()
  })

  it('saqlangandan keyin eslab qolinadi', async () => {
    open()
    await pickMaterial('Sement')
    typeQty('7')
    chooseUnit('qop')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    await pickMaterial('Sement')
    expect(await screen.findByTestId('last-qty')).toHaveTextContent('7 qop')
  })

  it('localStorage yopiq bo‘lsa ham forma ishlaydi', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    open()
    await pickMaterial('Sement')
    expect(screen.queryByTestId('last-qty')).not.toBeInTheDocument()
    spy.mockRestore()
  })
})
