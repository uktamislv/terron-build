import { lazy, type ComponentType, type ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router-dom'
import { AuthProvider } from '@/auth/AuthProvider'
import { ComingSoon } from '@/components/ComingSoon'
import { RouteErrorPage } from '@/components/ErrorBoundary'
import { NotFound } from '@/components/NotFound'
import { LazyBoundary } from '@/components/LazyBoundary'
import type { TgNavKey, WebNavKey } from '@/domain/roles'
import { TgAuthGate } from '@/tg/TgAuthGate'
import { RequireTgNav, TgIndex, TgLayout } from '@/tg/TgLayout'
import { tgNavItems } from '@/tg/nav'
import { WebLayout } from '@/web/WebLayout'
import { RequireAuth, RequireNav } from '@/web/guards'
import { webNavItems } from '@/web/nav'
import { LoginPage } from '@/web/pages/LoginPage'

// Sahifalar route darajasida alohida chunk'larda (bosh bundle'da — layout, auth va login).
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
}

const DashboardPage = page(() => import('@/web/pages/DashboardPage'), 'DashboardPage')
const MaterialsPage = page(() => import('@/web/pages/MaterialsPage'), 'MaterialsPage')
const MovementsPage = page(() => import('@/web/pages/MovementsPage'), 'MovementsPage')
const PurchasesPage = page(() => import('@/web/pages/PurchasesPage'), 'PurchasesPage')
const CashPage = page(() => import('@/web/pages/CashPage'), 'CashPage')
const EstimatesPage = page(() => import('@/web/pages/EstimatesPage'), 'EstimatesPage')
const RequestsPage = page(() => import('@/web/pages/RequestsPage'), 'RequestsPage')
const AlertsPage = page(() => import('@/web/pages/AlertsPage'), 'AlertsPage')
const UsersPage = page(() => import('@/web/pages/UsersPage'), 'UsersPage')
const ObjectsPage = page(() => import('@/web/pages/ObjectsPage'), 'ObjectsPage')

const TgHomePage = page(() => import('@/tg/pages/TgHomePage'), 'TgHomePage')
const MovementPage = page(() => import('@/tg/pages/MovementPage'), 'MovementPage')
const PurchasePage = page(() => import('@/tg/pages/PurchasePage'), 'PurchasePage')
const RequestPage = page(() => import('@/tg/pages/RequestPage'), 'RequestPage')
const InventoryPage = page(() => import('@/tg/pages/InventoryPage'), 'InventoryPage')
const MinePage = page(() => import('@/tg/pages/MinePage'), 'MinePage')

// Tayyor veb sahifalar; qolganlari hozircha "Tez orada"
const webPages: Partial<Record<WebNavKey, ComponentType>> = {
  materials: MaterialsPage,
  movements: MovementsPage,
  purchases: PurchasesPage,
  cash: CashPage,
  estimates: EstimatesPage,
  requests: RequestsPage,
  alerts: AlertsPage,
  users: UsersPage,
  objects: ObjectsPage,
}

const webSections = (Object.keys(webNavItems) as WebNavKey[]).filter((key) => key !== 'dashboard')
// Tayyor Mini App ekranlari; qolganlari hozircha "Tez orada"
const tgPages: Partial<Record<TgNavKey, ComponentType>> = {
  movement: MovementPage,
  purchase: PurchasePage,
  request: RequestPage,
  inventory: InventoryPage,
  mine: MinePage,
}

const tgSections = (Object.keys(tgNavItems) as TgNavKey[]).filter((key) => key !== 'home')

function render(Page: ComponentType | undefined, title: string): ReactNode {
  return Page ? (
    <LazyBoundary>
      <Page />
    </LazyBoundary>
  ) : (
    <ComingSoon title={title} />
  )
}

export const routes: RouteObject[] = [
  {
    // AuthProvider router ichida — useNavigate/Navigate ishlatish mumkin
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/',
        element: <RequireAuth />,
        errorElement: <RouteErrorPage />,
        children: [
          {
            element: <WebLayout />,
            children: [
              {
                index: true,
                element: <RequireNav navKey="dashboard">{render(DashboardPage, webNavItems.dashboard.label)}</RequireNav>,
              },
              ...webSections.map((key) => ({
                path: webNavItems[key].to.slice(1),
                element: <RequireNav navKey={key}>{render(webPages[key], webNavItems[key].label)}</RequireNav>,
              })),
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
      {
        path: '/tg',
        element: (
          <TgAuthGate>
            <TgLayout />
          </TgAuthGate>
        ),
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <TgIndex home={render(TgHomePage, tgNavItems.home.label)} /> },
          ...tgSections.map((key) => ({
            path: tgNavItems[key].to.replace('/tg/', ''),
            element: <RequireTgNav navKey={key}>{render(tgPages[key], tgNavItems[key].label)}</RequireTgNav>,
          })),
          { path: '*', element: <NotFound homePath="/tg" /> },
        ],
      },
    ],
  },
]
