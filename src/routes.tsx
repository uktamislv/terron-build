import type { RouteObject } from 'react-router-dom'
import { ComingSoon } from '@/components/ComingSoon'
import { NotFound } from '@/components/NotFound'
import { t } from '@/i18n'
import { TgLayout } from '@/tg/TgLayout'
import { TgHomePage } from '@/tg/pages/TgHomePage'
import { WebLayout } from '@/web/WebLayout'
import { webNav } from '@/web/nav'
import { DashboardPage } from '@/web/pages/DashboardPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <WebLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...webNav
        .filter((item) => item.to !== '/')
        .map((item) => ({ path: item.to.slice(1), element: <ComingSoon title={item.label} /> })),
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/tg',
    element: <TgLayout />,
    children: [
      { index: true, element: <TgHomePage /> },
      { path: 'movement', element: <ComingSoon title={t.tg.nav.movement} /> },
      { path: 'purchase', element: <ComingSoon title={t.tg.nav.purchase} /> },
      { path: 'mine', element: <ComingSoon title={t.tg.nav.mine} /> },
      { path: '*', element: <NotFound homePath="/tg" /> },
    ],
  },
]
