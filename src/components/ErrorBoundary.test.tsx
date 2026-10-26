import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { t } from '@/i18n'
import { claimAutoReload, installPreloadErrorReload, isChunkLoadError, RELOAD_FLAG } from '@/lib/chunkErrors'
import { RouteErrorPage } from './ErrorBoundary'
import { LazyBoundary } from './LazyBoundary'

function Boom({ error }: { error: Error }): never {
  throw error
}

const chunkError = new TypeError('Failed to fetch dynamically imported module: https://x/assets/Page-abc.js')

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('xato chegaralari', () => {
  it('lazy chunk yuklanmasa — "Ilova yangilandi" va "Qayta yuklash"', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    render(
      <LazyBoundary>
        <Boom error={chunkError} />
      </LazyBoundary>,
    )
    expect(screen.getByText(t.appError.chunkTitle)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.appError.reload }))
    expect(reload).toHaveBeenCalled()
  })

  it('boshqa xato — umumiy matn', () => {
    render(
      <LazyBoundary>
        <Boom error={new Error('render xato')} />
      </LazyBoundary>,
    )
    expect(screen.getByText(t.appError.title)).toBeInTheDocument()
    expect(screen.queryByText(t.appError.chunkTitle)).not.toBeInTheDocument()
  })

  it('route errorElement — loader/render xatosi', async () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <Boom error={chunkError} />, errorElement: <RouteErrorPage /> }],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    expect(await screen.findByText(t.appError.chunkTitle)).toBeInTheDocument()
  })
})

describe('chunk xatosi va avtomatik reload', () => {
  it('isChunkLoadError', () => {
    expect(isChunkLoadError(chunkError)).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true)
    expect(isChunkLoadError(new Error('x is undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('vite:preloadError — faqat bir marta reload (sessionStorage bayrog‘i)', () => {
    const reload = vi.fn()
    const off = installPreloadErrorReload(window, reload)
    const first = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(first)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(first.defaultPrevented).toBe(true)
    expect(sessionStorage.getItem(RELOAD_FLAG)).not.toBeNull()
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(1)
    off()
  })

  it('storage ishlamasa — reload qilinmaydi', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
    }
    expect(claimAutoReload(broken)).toBe(false)
    expect(claimAutoReload(null)).toBe(false)
  })
})
