import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { t } from './i18n'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
}

describe('router', () => {
  it('/ — veb panel bosh sahifasi va yon menyu', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: t.web.welcome })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.web.nav.materials })).toBeInTheDocument()
  })

  it('/tg — Mini App bosh ekrani va pastki menyu', () => {
    renderAt('/tg')
    expect(screen.getByText(t.status.outsideTelegram)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.tg.nav.purchase })).toBeInTheDocument()
  })

  it('noma’lum yo‘l — 404', () => {
    renderAt('/tg/yoq-sahifa')
    expect(screen.getByText(t.notFound.title)).toBeInTheDocument()
  })
})
