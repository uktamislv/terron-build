import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import { RepoError, toRepoError } from '@/data/errors'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as openPurchasesRepo from '@/data/openPurchasesRepo'
import * as photosRepo from '@/data/photosRepo'
import * as stockRepo from '@/data/stockRepo'
import type { Movement, OpenPurchase } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'
import { textOf } from '@/test/text'

const tg = vi.hoisted(() => ({
  app: null as null | { MainButton: Record<string, unknown>; BackButton: Record<string, unknown> },
  mainClick: null as null | (() => void),
}))

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

vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn() }))
vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({
  createMovement: vi.fn(),
  listMyMovements: vi.fn(),
  MOVEMENTS_PAGE_SIZE: 50,
}))
vi.mock('@/data/openPurchasesRepo', () => ({ listOpenPurchases: vi.fn(async () => []) }))
vi.mock('@/data/requestsRepo', () => ({ listMyRequests: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({ listMyTransfers: vi.fn(async () => []), listIncomingTransfers: vi.fn(async () => []) }))
vi.mock('@/data/purchasesRepo', () => ({ listMyPurchases: vi.fn(async () => []) }))
vi.mock('@/data/stockRepo', () => ({ getStock: vi.fn(), listStock: vi.fn() }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/photosRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosRepo')>()),
  uploadPhoto: vi.fn(),
  signedPhotoUrl: vi.fn(),
}))

const telegram = await import('@/tg/telegram')
const tm = t.tg.movement

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50.0000000000')] })
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const eski = makeMaterial('m-old', 'Eski material', 'dona', { is_active: false })
const objA = makeObject('o-a', 'Obyekt A')
const objB = makeObject('o-b', 'Obyekt B')

function savedRow(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'mv1',
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
    occurred_at: '2026-10-25T05:00:00Z',
    note: null,
    created_by: 'p-prorab',
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    created_by_name: 'Test prorab',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  tg.app = null
  tg.mainClick = null
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([qum, sement, eski])
  vi.mocked(stockRepo.getStock).mockResolvedValue('420')
  vi.mocked(movementsRepo.createMovement).mockResolvedValue(savedRow())
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

function save() {
  fireEvent.click(screen.getByRole('button', { name: tm.save }))
}

describe('/tg/movement — bitta obyektli prorab', () => {
  it('Kirim → material → 3 qop → "= 150 kg" → Saqlash → tasdiq va forma qayta', async () => {
    open()
    await pickMaterial('Sement')
    // Obyekt tanlash ekrani ko'rsatilmaydi — avtomatik
    expect(screen.queryByRole('region', { name: tm.chooseObject })).not.toBeInTheDocument()
    expect(screen.getByText('Obyekt A')).toBeInTheDocument()

    typeQty('3')
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    expect(screen.getByText(textOf('= 150 kg'))).toBeInTheDocument()

    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    const arg = vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]
    expect(arg).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      companyId: makeProfile('prorab').company_id,
      type: 'kirim',
      objectId: 'o-a',
      materialId: 'm-sem',
      unitId: 'u-qop',
      qtyInput: '3',
      note: '',
      photoPath: null,
      // jsdom'da joylashuv yo'q — saqlash to'xtamaydi, holat `unavailable`
      geo: { status: 'unavailable' },
    })
    expect(typeof arg?.qtyInput).toBe('string')
    expect(arg).not.toHaveProperty('qty_base')
    expect(arg).not.toHaveProperty('occurredAt')
    expect(photosRepo.uploadPhoto).not.toHaveBeenCalled()

    // Tasdiq: asosiy matn va obyekt — alohida qatorlarda (meta "·" bilan ulanmaydi)
    const banner = (await screen.findByText(/Kirim saqlandi: 3 qop Sement/)).closest('[role="status"]') as HTMLElement
    expect(within(banner).getByText('Obyekt A')).toBeInTheDocument()
    expect(telegram.haptic.success).toHaveBeenCalled()
    // Forma keyingi yozuv uchun: material tanlash, tur saqlangan
    expect(screen.getByRole('region', { name: tm.chooseMaterial })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.movements.types.kirim })).toHaveAttribute('aria-pressed', 'true')
  })

  it('faqat faol materiallar ko‘rsatiladi', async () => {
    open()
    const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
    expect(within(grid).queryByText('Eski material')).not.toBeInTheDocument()
    expect(within(grid).getByText('Qum')).toBeInTheDocument()
  })

  it('miqdor bo‘sh — xato, saqlanmaydi', async () => {
    open()
    await pickMaterial('Sement')
    save()
    expect(await screen.findByText(tm.errors.qty.required)).toBeInTheDocument()
    expect(movementsRepo.createMovement).not.toHaveBeenCalled()
  })

  it('Telegram ichida — MainButton orqali saqlanadi', async () => {
    tg.app = {
      MainButton: {
        setText: vi.fn(function (this: unknown) {
          return tg.app?.MainButton
        }),
        onClick: vi.fn((cb: () => void) => {
          tg.mainClick = cb
          return tg.app?.MainButton
        }),
        offClick: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        showProgress: vi.fn(),
        hideProgress: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      },
      BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    }
    open()
    await pickMaterial('Sement')
    expect(screen.queryByRole('button', { name: tm.save })).not.toBeInTheDocument()
    typeQty('2')
    await waitFor(() => expect(tg.mainClick).not.toBeNull())
    act(() => tg.mainClick?.())
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].qtyInput).toBe('2')
  })
})

describe('/tg/movement — boshqa holatlar', () => {
  it('bir nechta obyekt — avval tanlanadi', async () => {
    vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA, objB])
    open()
    const region = await screen.findByRole('region', { name: tm.chooseObject })
    fireEvent.click(within(region).getByRole('button', { name: 'Obyekt B' }))
    await pickMaterial('Qum')
    typeQty('1,5')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    const arg = vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]
    expect(arg?.objectId).toBe('o-b')
    expect(arg?.qtyInput).toBe('1.5')
  })

  it('chiqim qoldiqdan ko‘p — sariq ogohlantirish, lekin saqlanadi', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: t.movements.types.chiqim }))
    await pickMaterial('Sement')
    typeQty('10')
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    expect(await screen.findByText('Qoldiq: 420 kg → \u221280 kg')).toBeInTheDocument()
    expect(screen.getByText(tm.warnings.exceeds_stock)).toBeInTheDocument()
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].type).toBe('chiqim')
    // tanlov eslab qolinadi
    expect(window.localStorage.getItem('terron.movement.type')).toBe('chiqim')
  })

  it('server ops_occurred_at_range xatosi ko‘rsatiladi, ma’lumot saqlanadi', async () => {
    vi.mocked(movementsRepo.createMovement).mockRejectedValue(
      toRepoError({ code: '23514', hint: 'ops_occurred_at_range', message: 'x' }),
    )
    open()
    await pickMaterial('Sement')
    typeQty('3')
    save()
    expect(await screen.findByText(new RegExp(t.errors.ops_occurred_at_range))).toBeInTheDocument()
    expect(telegram.haptic.error).toHaveBeenCalled()
    expect(screen.getByLabelText(tm.qty)).toHaveValue('3')
  })

  it('rasm tanlansa — Saqlashda uploadPhoto chaqiriladi va yo‘l yuboriladi', async () => {
    vi.mocked(photosRepo.uploadPhoto).mockResolvedValue('c/2026/10/abc.jpg')
    open()
    await pickMaterial('Sement')
    typeQty('3')
    const file = new File(['x'], 'chek.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText(tm.takePhoto), { target: { files: [file] } })
    expect(await screen.findByText('chek.jpg')).toBeInTheDocument()
    // Tanlashda yuklanmaydi
    expect(photosRepo.uploadPhoto).not.toHaveBeenCalled()
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(photosRepo.uploadPhoto).toHaveBeenCalledWith(expect.any(Blob), makeProfile('prorab').company_id, 'ops')
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].photoPath).toBe('c/2026/10/abc.jpg')
  })
})

describe('/tg/movement — idempotentlik va rasm xatolari', () => {
  it('ikki tez bosish — bitta createMovement', async () => {
    let resolve: (m: Movement) => void = () => undefined
    vi.mocked(movementsRepo.createMovement).mockImplementation(() => new Promise((r) => (resolve = r)))
    open()
    await pickMaterial('Sement')
    typeQty('3')
    const button = screen.getByRole('button', { name: tm.save })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    await act(async () => resolve(savedRow()))
    expect(await screen.findByText(/Kirim saqlandi/)).toBeInTheDocument()
    expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1)
  })

  it('tarmoq xatosidan keyin qayta urinish — bir xil id; keyingi yozuv — yangi id', async () => {
    vi.mocked(movementsRepo.createMovement)
      .mockRejectedValueOnce(toRepoError(new TypeError('Failed to fetch')))
      .mockResolvedValueOnce(savedRow())
    open()
    await pickMaterial('Sement')
    typeQty('3')
    save()
    expect(await screen.findByText(new RegExp(t.errors.network))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.common.retry }))
    expect(await screen.findByText(/Kirim saqlandi/)).toBeInTheDocument()
    const [first, second] = vi.mocked(movementsRepo.createMovement).mock.calls.map((c) => c[0].id)
    expect(second).toBe(first)

    await pickMaterial('Qum')
    typeQty('1')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(3))
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[2]?.[0].id).not.toBe(first)
  })

  it('MainButton saqlash paytida progress va disable', async () => {
    const main = {
      setText: vi.fn(() => main),
      onClick: vi.fn((cb: () => void) => {
        tg.mainClick = cb
        return main
      }),
      offClick: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      showProgress: vi.fn(),
      hideProgress: vi.fn(),
    }
    tg.app = { MainButton: main, BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } }
    vi.mocked(movementsRepo.createMovement).mockImplementation(() => new Promise(() => undefined))
    open()
    await pickMaterial('Sement')
    typeQty('3')
    await waitFor(() => expect(tg.mainClick).not.toBeNull())
    act(() => tg.mainClick?.())
    await waitFor(() => expect(main.showProgress).toHaveBeenCalled())
    expect(main.disable).toHaveBeenCalled()
  })

  it('rasm yuklanmasa — "Rasmsiz saqlash" bilan saqlanadi', async () => {
    vi.mocked(photosRepo.uploadPhoto).mockRejectedValue(new RepoError('photo_upload_failed'))
    open()
    await pickMaterial('Sement')
    typeQty('3')
    fireEvent.change(screen.getByLabelText(tm.fromGallery), {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    })
    await screen.findByText('a.jpg')
    save()
    expect(await screen.findByText(t.errors.photo_upload_failed)).toBeInTheDocument()
    expect(movementsRepo.createMovement).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: tm.saveWithoutPhoto }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].photoPath).toBeNull()
  })

  it('server ops_photo_reused — "Rasmsiz saqlash" yo‘li', async () => {
    const reused = toRepoError({ code: '23505', hint: 'ops_photo_reused', message: 'x' })
    vi.mocked(photosRepo.uploadPhoto).mockResolvedValue('c/2026/10/abc.jpg')
    vi.mocked(movementsRepo.createMovement).mockRejectedValueOnce(reused).mockResolvedValueOnce(savedRow())
    open()
    await pickMaterial('Sement')
    typeQty('3')
    fireEvent.change(screen.getByLabelText(tm.takePhoto), {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    })
    await screen.findByText('a.jpg')
    save()
    expect(await screen.findByText(t.errors.ops_photo_reused)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tm.saveWithoutPhoto }))
    expect(await screen.findByText(/Kirim saqlandi/)).toBeInTheDocument()
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[1]?.[0].photoPath).toBeNull()
  })

  it('ochib bo‘lmaydigan rasm (HEIC) — darhol xabar, rasm olib tashlanadi, forma qoladi', async () => {
    open()
    await pickMaterial('Sement')
    typeQty('3')
    fireEvent.change(screen.getByLabelText(tm.fromGallery), {
      target: { files: [new File(['x'], 'b.heic', { type: 'image/heic' })] },
    })
    expect(await screen.findByText(t.errors.photo_type)).toBeInTheDocument()
    expect(screen.queryByText('b.heic')).not.toBeInTheDocument()
    expect(screen.getByLabelText(tm.qty)).toHaveValue('3')
    expect(photosRepo.uploadPhoto).not.toHaveBeenCalled()
  })

  it('kamera va galereya — ikki alohida input', async () => {
    open()
    await pickMaterial('Sement')
    expect(screen.getByLabelText(tm.takePhoto)).toHaveAttribute('capture', 'environment')
    expect(screen.getByLabelText(tm.fromGallery)).not.toHaveAttribute('capture')
  })
})

describe('/tg/movement — super_admin va qoldiq', () => {
  it('super_admin — faqat o‘z firmasining obyekt va materiallari', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('super_admin'))
    vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA, { ...makeObject('o-x', 'Begona obyekt'), company_id: 'other' }])
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([
      sement,
      { ...makeMaterial('m-x', 'Begona material', 'kg'), company_id: 'other' },
    ])
    open()
    const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
    expect(within(grid).queryByText('Begona material')).not.toBeInTheDocument()
    // Bitta (o'z) obyekt qoldi — avtomatik tanlangan
    expect(screen.queryByRole('region', { name: tm.chooseObject })).not.toBeInTheDocument()
    expect(screen.queryByText('Begona obyekt')).not.toBeInTheDocument()
  })

  it('qoldiq so‘rovi xato — qoldiq va ogohlantirish ko‘rsatilmaydi', async () => {
    vi.mocked(stockRepo.getStock).mockRejectedValue(toRepoError(new TypeError('Failed to fetch')))
    open()
    fireEvent.click(await screen.findByRole('button', { name: t.movements.types.chiqim }))
    await pickMaterial('Sement')
    typeQty('100')
    await waitFor(() => expect(stockRepo.getStock).toHaveBeenCalled())
    expect(screen.getByText(textOf('= 100 kg'))).toBeInTheDocument()
    expect(screen.queryByText(/Qoldiq:/)).not.toBeInTheDocument()
    expect(screen.queryByText(tm.warnings.exceeds_stock)).not.toBeInTheDocument()
  })
})

describe('/tg/mine', () => {
  it('o‘z yozuvlari ro‘yxati va tafsilot (signed URL rasm)', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([
      savedRow({ photo_path: 'c/2026/10/abc.jpg' }),
      savedRow({ id: 'mv2', type: 'chiqim', material_name: 'Qum', deleted_at: '2026-10-25T06:00:00Z' }),
    ])
    vi.mocked(photosRepo.signedPhotoUrl).mockResolvedValue('https://signed/url')
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/tg/mine'] })} />)
    const list = within(await screen.findByRole('list', { name: t.tg.mine.title }))
    expect(movementsRepo.listMyMovements).toHaveBeenCalledWith('p-prorab', 50)
    expect(list.getAllByRole('button')).toHaveLength(2)
    expect(list.getByText(t.movements.deleted)).toBeInTheDocument()
    expect(list.getByLabelText(t.movements.hasPhoto)).toBeInTheDocument()

    fireEvent.click(list.getByText('Sement'))
    const img = await screen.findByRole('img', { name: t.movements.photo })
    expect(img).toHaveAttribute('src', 'https://signed/url')
    expect(photosRepo.signedPhotoUrl).toHaveBeenCalledWith('c/2026/10/abc.jpg')
    // Tashqi havola yo'q — rasm faqat ilova ichida
    expect(img.closest('a')).toBeNull()
    expect(photosRepo.SIGNED_URL_TTL).toBe(600)
  })
})

describe('/tg/movement — bog‘langan xarid (kirim)', () => {
  const tl = tm.linked
  function openPurchase(id: string, overrides: Partial<OpenPurchase> = {}): OpenPurchase {
    return {
      id,
      purchased_at: '2026-10-24T05:00:00Z',
      buyer_id: 'p-haydovchi',
      buyer_name: 'Ali haydovchi',
      qty_base: '150',
      received_qty_base: '100',
      remaining_qty_base: '50',
      unit_input: 'qop',
      unit_variant: null,
      qty_input: '3',
      ...overrides,
    }
  }

  it('Batch 12 (A): bitta ochiq xarid — oldindan tanlangan, qo‘shimcha bosishsiz bog‘lanadi', async () => {
    vi.mocked(openPurchasesRepo.listOpenPurchases).mockResolvedValue([openPurchase('pu1')])
    open()
    await pickMaterial('Sement')
    const region = await screen.findByRole('region', { name: tl.title })
    expect(openPurchasesRepo.listOpenPurchases).toHaveBeenCalledWith('o-a', 'm-sem')
    expect(within(region).getByText(tl.remaining('50', 'kg'))).toBeInTheDocument()
    expect(await within(region).findByText(tl.autoLinked)).toBeInTheDocument()
    expect(within(region).getByTestId('open-purchase')).toHaveAttribute('data-linked', 'true')
    typeQty('1')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].purchaseId).toBe('pu1')
  })

  it('Batch 12 (A): bir bosishda olib tashlanadi — purchaseId yuborilmaydi; "Bog‘lash" bilan qaytariladi', async () => {
    vi.mocked(openPurchasesRepo.listOpenPurchases).mockResolvedValue([openPurchase('pu1')])
    open()
    await pickMaterial('Sement')
    const region = await screen.findByRole('region', { name: tl.title })
    fireEvent.click(await within(region).findByRole('button', { name: tl.remove }))
    expect(within(region).getByTestId('open-purchase')).not.toHaveAttribute('data-linked')
    expect(within(region).getByText(tl.suggestion)).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: tl.link })).toBeInTheDocument()
    typeQty('1')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]).not.toHaveProperty('purchaseId')
  })

  it('bir nechta — foydalanuvchi keraklisini bog‘laydi', async () => {
    vi.mocked(openPurchasesRepo.listOpenPurchases).mockResolvedValue([
      openPurchase('pu1'),
      openPurchase('pu2', { buyer_name: 'Vali taminotchi', remaining_qty_base: '20' }),
    ])
    open()
    await pickMaterial('Sement')
    const region = await screen.findByRole('region', { name: tl.title })
    expect(within(region).getByText(tl.choose)).toBeInTheDocument()
    expect(within(region).queryByText(tl.suggestion)).not.toBeInTheDocument()
    // Hech biri oldindan tanlanmagan
    expect(within(region).getAllByTestId('open-purchase').filter((c) => c.hasAttribute('data-linked'))).toHaveLength(0)
    const cards = within(region).getAllByTestId('open-purchase')
    fireEvent.click(within(cards[1] as HTMLElement).getByRole('button', { name: tl.link }))
    typeQty('1')
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0].purchaseId).toBe('pu2')
  })

  it('Batch 12 (A): bir nechta — eng eskisi birinchi', async () => {
    vi.mocked(openPurchasesRepo.listOpenPurchases).mockResolvedValue([
      openPurchase('pu-new', { purchased_at: '2026-10-24T05:00:00Z', buyer_name: 'Yangi' }),
      openPurchase('pu-old', { purchased_at: '2026-10-20T05:00:00Z', buyer_name: 'Eski' }),
    ])
    open()
    await pickMaterial('Sement')
    const region = await screen.findByRole('region', { name: tl.title })
    await waitFor(() => expect(within(region).getAllByTestId('open-purchase')).toHaveLength(2))
    const cards = within(region).getAllByTestId('open-purchase')
    expect(cards[0]).toHaveTextContent('Eski')
    expect(cards[1]).toHaveTextContent('Yangi')
  })

  it('asosiy bo‘lmagan birlik — "= 150 kg" katta ko‘rsatiladi', async () => {
    open()
    await pickMaterial('Sement')
    typeQty('3')
    expect(screen.getByTestId('base-qty')).not.toHaveAttribute('data-emphasized')
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    expect(screen.getByTestId('base-qty')).toHaveAttribute('data-emphasized', 'true')
  })

  it('chiqimda bo‘lim ko‘rsatilmaydi va purchaseId yuborilmaydi', async () => {
    vi.mocked(openPurchasesRepo.listOpenPurchases).mockResolvedValue([openPurchase('pu1')])
    open()
    fireEvent.click(await screen.findByRole('button', { name: t.movements.types.chiqim }))
    await pickMaterial('Sement')
    typeQty('1')
    expect(screen.queryByRole('region', { name: tl.title })).not.toBeInTheDocument()
    save()
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]).not.toHaveProperty('purchaseId')
  })
})

describe('11: bosishlar soni — kirim/chiqim odatiy holatda ≤ 4 bosish', () => {
  function telegramApp() {
    const main: Record<string, unknown> = {}
    Object.assign(main, {
      setText: vi.fn(() => main),
      onClick: vi.fn((cb: () => void) => {
        tg.mainClick = cb
        return main
      }),
      offClick: vi.fn(() => main),
      enable: vi.fn(() => main),
      disable: vi.fn(() => main),
      showProgress: vi.fn(() => main),
      hideProgress: vi.fn(() => main),
      show: vi.fn(() => main),
      hide: vi.fn(() => main),
      setParams: vi.fn(() => main),
    })
    return { MainButton: main, BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } }
  }

  it('Bosh → "Kirim" → material → miqdor (klaviatura) → birlik → MainButton: 4 bosish', async () => {
    tg.app = telegramApp()
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([])
    let taps = 0
    const tap = (el: HTMLElement) => {
      taps += 1
      fireEvent.click(el)
    }
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/tg'] })} />)
    tap(await screen.findByRole('link', { name: new RegExp(t.movements.types.kirim) }))
    const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
    tap(within(grid).getByRole('button', { name: /Sement/ }))
    // Miqdor — klaviatura (bosish emas); maydon ochilganda fokusda
    const qty = screen.getByLabelText(tm.qty)
    expect(qty).toHaveFocus()
    fireEvent.change(qty, { target: { value: '3' } })
    // Birlik chiplari — miqdor maydoni ostida darhol (klaviatura ularni yopmaydi)
    const units = screen.getByRole('group', { name: tm.unit })
    expect(units.previousElementSibling?.contains(qty)).toBe(true)
    tap(within(units).getByRole('button', { name: 'qop' }))
    // Sana — obyekt satridagi ixcham chip (standart "Bugun", bosish shart emas)
    expect(screen.getByTestId('date-chip')).toHaveTextContent(t.tg.date.today)
    await waitFor(() => expect(tg.mainClick).not.toBeNull())
    taps += 1
    act(() => tg.mainClick?.())
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]).toMatchObject({ type: 'kirim', unitId: 'u-qop', qtyInput: '3' })
    expect(taps).toBeLessThanOrEqual(4)
  })

  it('5: "Qoldiq" qatoridan — chiqim, material oldindan tanlangan', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([])
    render(
      <RouterProvider
        router={createMemoryRouter(routes, {
          initialEntries: [{ pathname: '/tg/movement', state: { movementPrefill: { type: 'chiqim', objectId: 'o-a', materialId: 'm-sem' } } }],
        })}
      />,
    )
    expect(await screen.findByLabelText(tm.qty)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.movements.types.chiqim })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Sement' })).toBeInTheDocument()
  })
})
