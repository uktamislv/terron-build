import type { ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router-dom'
import { AuthProvider } from '@/auth/AuthProvider'
import { ComingSoon } from '@/components/ComingSoon'
import { NotFound } from '@/components/NotFound'
import type { TgNavKey, WebNavKey } from '@/domain/roles'
import { TgAuthGate } from '@/tg/TgAuthGate'
import { RequireTgNav, TgIndex, TgLayout } from '@/tg/TgLayout'
import { tgNavItems } from '@/tg/nav'
import { MinePage } from '@/tg/pages/MinePage'
import { MovementPage } from '@/tg/pages/MovementPage'
import { PurchasePage } from '@/tg/pages/PurchasePage'
import { TgHomePage } from '@/tg/pages/TgHomePage'
import { WebLayout } from '@/web/WebLayout'
import { RequireAuth, RequireNav } from '@/web/guards'
import { webNavItems } from '@/web/nav'
import { AlertsPage } from '@/web/pages/AlertsPage'
import { CashPage } from '@/web/pages/CashPage'
import { DashboardPage } from '@/web/pages/DashboardPage'
import { EstimatesRoute } from '@/web/pages/EstimatesRoute'
import { LoginPage } from '@/web/pages/LoginPage'
import { MaterialsPage } from '@/web/pages/MaterialsPage'
import { MovementsPage } from '@/web/pages/MovementsPage'
import { ObjectsPage } from '@/web/pages/ObjectsPage'
import { PurchasesPage } from '@/web/pages/PurchasesPage'
import { UsersPage } from '@/web/pages/UsersPage'

// Tayyor veb sahifalar; qolganlari hozircha "Tez orada"
const webPages: Partial<Record<WebNavKey, ReactNode>> = {
  materials: <MaterialsPage />,
  movements: <MovementsPage />,
  purchases: <PurchasesPage />,
  cash: <CashPage />,
  estimates: <EstimatesRoute />,
  alerts: <AlertsPage />,
  users: <UsersPage />,
  objects: <ObjectsPage />,
}

const webSections = (Object.keys(webNavItems) as WebNavKey[]).filter((key) => key !== 'dashboard')
// Tayyor Mini App ekranlari; qolganlari hozircha "Tez orada"
const tgPages: Partial<Record<TgNavKey, ReactNode>> = {
  movement: <MovementPage />,
  purchase: <PurchasePage />,
  mine: <MinePage />,
}

const tgSections = (Object.keys(tgNavItems) as TgNavKey[]).filter((key) => key !== 'home')

export const routes: RouteObject[] = [
  {
    // AuthProvider router ichida — useNavigate/Navigate ishlatish mumkin
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/',
        element: <RequireAuth />,
        children: [
          {
            element: <WebLayout />,
            children: [
              {
                index: true,
                element: (
                  <RequireNav navKey="dashboard">
                    <DashboardPage />
                  </RequireNav>
                ),
              },
              ...webSections.map((key) => ({
                path: webNavItems[key].to.slice(1),
                element: (
                  <RequireNav navKey={key}>
                    {webPages[key] ?? <ComingSoon title={webNavItems[key].label} />}
                  </RequireNav>
                ),
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
        children: [
          { index: true, element: <TgIndex home={<TgHomePage />} /> },
          ...tgSections.map((key) => ({
            path: tgNavItems[key].to.replace('/tg/', ''),
            element: (
              <RequireTgNav navKey={key}>
                {tgPages[key] ?? <ComingSoon title={tgNavItems[key].label} />}
              </RequireTgNav>
            ),
          })),
          { path: '*', element: <NotFound homePath="/tg" /> },
        ],
      },
    ],
  },
]
