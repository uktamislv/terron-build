// Bosh sahifa: rolga qarab bo'limlar va kartochkalar (havolalar filtr bilan). Sof funksiyalar.
// Ko'rinadigan raqamlarni baribir RLS cheklaydi; bu yerda faqat qaysi bo'lim chizilishi.
import type { DashboardSummary } from '@/data/reportsRepo'
import { isNegative, isZero } from '@/domain/decimal'
import { webNavFor, type Role, type WebNavKey } from '@/domain/roles'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'

export type DashSection = 'movements' | 'purchases' | 'cash' | 'alerts' | 'requests' | 'norm'

const ALL: readonly DashSection[] = ['movements', 'purchases', 'cash', 'alerts', 'requests', 'norm']

const SECTIONS: Record<Role, readonly DashSection[]> = {
  super_admin: ALL,
  admin: ALL,
  direktor: ALL,
  buxgalter: ALL,
  // o'z obyektlari — RLS
  prorab: ['movements', 'purchases', 'requests', 'norm'],
  omborchi: ['movements'],
  taminotchi: ['purchases', 'requests'],
  // faqat o'z inventarizatsiyalari (Mini App) — kartochkalarsiz
  tekshiruvchi: [],
  haydovchi: [],
}

export function dashboardSections(role: Role): Set<DashSection> {
  return new Set(SECTIONS[role] ?? [])
}

export type CardKey =
  | 'kirim'
  | 'chiqim'
  | 'purchases'
  | 'cashIssued'
  | 'cashOnHand'
  | 'alertsOpen'
  | 'unreceived'
  | 'pendingTransfers'
  | 'pendingRequests'
  | 'overNorm'

export type CardTone = 'default' | 'danger' | 'warn'

export interface DashCard {
  key: CardKey
  label: string
  value: string
  sub: string | null
  tone: CardTone
  /** Joriy holat (davrga bog'liq emas) — kartochkada "hozir". */
  current: boolean
  /** Obyekt filtriga qaramaydi (podotchet). */
  companyWide: boolean
  /** Rol shu sahifaga kira olmasa — null (havolasiz kartochka). */
  to: string | null
}

export interface CardRange {
  from: string
  to: string
  objectId: string
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

function count(n: number): string {
  return t.reports.countUnit(formatQty(String(n)))
}

/** Kartochkalar — bo'limlar tartibida; havola faqat rolning menyusida bor sahifaga. */
export function buildCards(s: DashboardSummary, role: Role, r: CardRange): DashCard[] {
  const sections = dashboardSections(role)
  const nav = new Set<WebNavKey>(webNavFor(role))
  const link = (key: WebNavKey, path: string) => (nav.has(key) ? path : null)
  const obj = r.objectId || undefined
  const period = { from: r.from, to: r.to, object: obj }
  const tc = t.reports.cards
  const cards: DashCard[] = []

  if (sections.has('movements')) {
    cards.push(
      {
        key: 'kirim',
        current: false,
        companyWide: false,
        label: tc.kirim,
        value: count(s.kirim_count),
        sub: null,
        tone: 'default',
        to: link('movements', `/movements${qs({ type: 'kirim', ...period })}`),
      },
      {
        key: 'chiqim',
        current: false,
        companyWide: false,
        label: tc.chiqim,
        value: count(s.chiqim_count),
        sub: null,
        tone: 'default',
        to: link('movements', `/movements${qs({ type: 'chiqim', ...period })}`),
      },
    )
  }
  if (sections.has('purchases')) {
    cards.push({
      key: 'purchases',
      current: false,
      companyWide: false,
      label: tc.purchases,
      value: formatSum(s.purchases_sum),
      sub: count(s.purchases_count),
      tone: 'default',
      to: link('purchases', `/purchases${qs(period)}`),
    })
  }
  if (sections.has('cash')) {
    cards.push(
      {
        key: 'cashIssued',
        current: false,
        companyWide: true,
        label: tc.cashIssued,
        value: formatSum(s.cash_issued_sum),
        sub: s.cash_returned_sum && !isZero(s.cash_returned_sum) ? tc.cashReturnedSub(formatSum(s.cash_returned_sum)) : null,
        tone: 'default',
        to: link('cash', '/cash'),
      },
      {
        key: 'cashOnHand',
        current: true,
        companyWide: true,
        label: tc.cashOnHand,
        value: formatSum(s.cash_on_hand_total),
        sub: null,
        tone: isNegative(s.cash_on_hand_total) ? 'danger' : 'default',
        to: link('cash', '/cash'),
      },
    )
  }
  if (sections.has('alerts')) {
    cards.push({
      key: 'alertsOpen',
      current: true,
      companyWide: false,
      label: tc.alertsOpen,
      value: count(s.alerts_open),
      sub: `${t.reports.seriousSub(formatQty(String(s.alerts_serious_open)))} · ${t.reports.newInPeriodSub(
        formatQty(String(s.alerts_new_in_period)),
      )}`,
      tone: s.alerts_serious_open > 0 ? 'danger' : s.alerts_open > 0 ? 'warn' : 'default',
      to: link('alerts', `/alerts${qs({ status: 'open', object: obj })}`),
    })
  }
  if (sections.has('purchases')) {
    cards.push({
      key: 'unreceived',
      current: true,
      companyWide: false,
      label: tc.unreceived,
      value: count(s.unreceived_purchases_count),
      sub: null,
      tone: s.unreceived_purchases_count > 0 ? 'warn' : 'default',
      to: link('purchases', `/purchases${qs({ object: obj })}`),
    })
  }
  if (sections.has('movements')) {
    cards.push({
      key: 'pendingTransfers',
      current: true,
      companyWide: false,
      label: tc.pendingTransfers,
      value: count(s.pending_transfers_count),
      sub: null,
      tone: s.pending_transfers_count > 0 ? 'warn' : 'default',
      to: link('movements', `/movements${qs({ tab: 'transfers' })}`),
    })
  }
  if (sections.has('requests')) {
    cards.push({
      key: 'pendingRequests',
      current: true,
      companyWide: false,
      label: tc.pendingRequests,
      value: count(s.pending_requests_count),
      sub: null,
      tone: s.pending_requests_count > 0 ? 'warn' : 'default',
      to: link('requests', `/requests${qs({ status: 'kutilmoqda', object: obj })}`),
    })
  }
  if (sections.has('norm')) {
    cards.push({
      key: 'overNorm',
      current: true,
      companyWide: false,
      label: tc.overNorm,
      value: count(s.objects_over_norm_count),
      sub: null,
      tone: s.objects_over_norm_count > 0 ? 'danger' : 'default',
      to: link('estimates', `/estimates${qs({ object: obj })}`),
    })
  }
  return cards
}

/** Eksport "Xulosa" varag'i: ko'rsatkich va aniq qiymat (son yoki pul — Dec satr). */
export function summaryExportRows(s: DashboardSummary, role: Role): { indicator: string; value: string }[] {
  const sections = dashboardSections(role)
  const tc = t.reports.cards
  const rows: { indicator: string; value: string }[] = []
  const n = (v: number) => String(v)
  if (sections.has('movements')) rows.push({ indicator: tc.kirim, value: n(s.kirim_count) }, { indicator: tc.chiqim, value: n(s.chiqim_count) })
  if (sections.has('purchases')) {
    rows.push(
      { indicator: t.reports.exportRows.purchasesSum, value: s.purchases_sum },
      { indicator: t.reports.exportRows.purchasesCount, value: n(s.purchases_count) },
    )
  }
  if (sections.has('cash')) {
    rows.push({ indicator: tc.cashIssued, value: s.cash_issued_sum }, { indicator: tc.cashOnHand, value: s.cash_on_hand_total })
  }
  if (sections.has('alerts')) {
    rows.push(
      { indicator: tc.alertsOpen, value: n(s.alerts_open) },
      { indicator: t.reports.exportRows.alertsSerious, value: n(s.alerts_serious_open) },
    )
  }
  if (sections.has('purchases')) rows.push({ indicator: tc.unreceived, value: n(s.unreceived_purchases_count) })
  if (sections.has('movements')) rows.push({ indicator: tc.pendingTransfers, value: n(s.pending_transfers_count) })
  if (sections.has('requests')) rows.push({ indicator: tc.pendingRequests, value: n(s.pending_requests_count) })
  if (sections.has('norm')) rows.push({ indicator: tc.overNorm, value: n(s.objects_over_norm_count) })
  return rows
}
