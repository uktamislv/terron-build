import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import {
  emptyBalance,
  listBalances,
  listCashHistory,
  restoreAdvance,
  softDeleteAdvance,
  type CashHistoryEntry,
} from '@/data/cashRepo'
import { listProfiles } from '@/data/profilesRepo'
import type { CashBalance, Profile } from '@/data/types'
import { isNegative, isZero } from '@/domain/decimal'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime, formatSum } from '@/lib/format'
import { IssueAdvanceDialog } from '../cash/IssueAdvanceDialog'
import { RetryNotice, SelectField } from '../fields'

const tc = t.cash

type Tone = 'negative' | 'zero' | 'positive'

/** Qo'limdagi pul rangi: manfiy — qizil, nol — kulrang, musbat — yashil. */
function balanceTone(balance: string): Tone {
  if (isNegative(balance)) return 'negative'
  return isZero(balance) ? 'zero' : 'positive'
}

const TONE_CLASS: Record<Tone, string> = {
  negative: 'text-danger',
  zero: 'text-slate-500',
  positive: 'text-ok',
}

function lastActivity(b: CashBalance): string | null {
  const dates = [b.last_issued_at, b.last_spent_at].filter((x): x is string => Boolean(x))
  if (dates.length === 0) return null
  return dates.reduce((a, c) => (Date.parse(c) > Date.parse(a) ? c : a))
}

type Dialog =
  | { kind: 'issue'; initial?: { recipientId: string; amount: string; note: string | null } }
  | { kind: 'delete'; entry: CashHistoryEntry }
  | null

/** Podotchet: odamlar bo'yicha qo'limdagi pul, pul berish, tarix. */
export function CashPage() {
  const { profile: me } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [balances, setBalances] = useState<CashBalance[] | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [history, setHistory] = useState<CashHistoryEntry[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [personId, setPersonId] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const role = me?.role
  const canIssue = role ? can(role, 'issue_cash') : false
  const canRestore = role ? can(role, 'restore_records') : false
  const canSeeDeleted = canIssue || role === 'direktor'

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listProfiles()
      .then((list) => alive && setProfiles(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    listBalances()
      .then((rows) => {
        if (!alive) return
        setBalances(rows)
        setBalanceError(null)
      })
      .catch((err: unknown) => alive && setBalanceError(errorText(err)))
    return () => {
      alive = false
    }
  }, [reloadKey])

  useEffect(() => {
    let alive = true
    listCashHistory({ profileId: personId || undefined, includeDeleted: canSeeDeleted && includeDeleted })
      .then((rows) => {
        if (!alive) return
        setHistory(rows)
        setHistoryError(null)
      })
      .catch((err: unknown) => alive && setHistoryError(errorText(err)))
    return () => {
      alive = false
    }
  }, [personId, includeDeleted, canSeeDeleted, reloadKey])

  // Xarid kiritadigan rollar (pul oluvchilar) + balansi bor har kim
  const recipients = useMemo(
    () => profiles.filter((p) => p.is_active && can(p.role, 'create_purchase')),
    [profiles],
  )
  const rows = useMemo(() => {
    if (!balances || !me) return []
    const byId = new Map(balances.map((b) => [b.profile_id, b]))
    const people = new Map<string, Profile>()
    for (const p of recipients) people.set(p.id, p)
    for (const p of profiles) if (byId.has(p.id)) people.set(p.id, p)
    return [...people.values()]
      .map((p) => ({ profile: p, balance: byId.get(p.id) ?? emptyBalance(me.company_id, p.id) }))
      .sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name, 'uz'))
  }, [balances, profiles, recipients, me])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setDialog(null)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  /** Summani o'zgartirib bo'lmaydi: eski yozuv o'chiriladi va shu qiymatlar bilan yangi berish ochiladi. */
  const deleteAndReissue = async (entry: CashHistoryEntry) => {
    setBusy(true)
    setActionError(null)
    try {
      await softDeleteAdvance(entry.id)
      reload()
      setDialog({ kind: 'issue', initial: { recipientId: entry.profileId, amount: entry.amount, note: entry.note } })
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!me) return null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{tc.title}</h1>
        {canIssue && (
          <Button
            onClick={() => {
              setDone(null)
              setDialog({ kind: 'issue' })
            }}
          >
            {tc.issue}
          </Button>
        )}
      </div>
      {done && <Notice tone="ok">{done}</Notice>}

      <section className="flex flex-col gap-3" aria-label={tc.balancesTitle}>
        <h2 className="text-lg font-semibold text-brand-dark">{tc.balancesTitle}</h2>
        {balanceError && <RetryNotice message={balanceError} onRetry={reload} />}
        {!balances && !balanceError && <Spinner />}
        {balances && rows.length === 0 && <p className="text-slate-600">{tc.noBalances}</p>}
        {balances && rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{tc.colPerson}</th>
                  <th className="px-3 py-2 font-medium">{tc.colRole}</th>
                  <th className="px-3 py-2 text-right font-medium">{tc.colIssued}</th>
                  <th className="px-3 py-2 text-right font-medium">{tc.colSpent}</th>
                  <th className="px-3 py-2 text-right font-medium">{tc.colBalance}</th>
                  <th className="px-3 py-2 font-medium">{tc.colLast}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ profile, balance }) => {
                  const tone = balanceTone(balance.balance)
                  const last = lastActivity(balance)
                  return (
                    <tr key={profile.id} data-testid="balance-row" className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{profile.full_name}</td>
                      <td className="px-3 py-2 text-slate-600">{t.roles[profile.role]}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{formatSum(balance.issued_total)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{formatSum(balance.spent_total)}</td>
                      <td
                        data-tone={tone}
                        title={tone === 'negative' ? tc.negativeHint : undefined}
                        className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${TONE_CLASS[tone]}`}
                      >
                        {formatSum(balance.balance)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{last ? formatDate(last) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label={tc.historyTitle}>
        <h2 className="text-lg font-semibold text-brand-dark">{tc.historyTitle}</h2>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <SelectField label={tc.filterPerson} value={personId} onChange={setPersonId}>
            <option value="">{tc.all}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </SelectField>
          {canSeeDeleted && (
            <label className="flex min-h-11 items-center gap-2 self-end text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-5"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
              />
              {tc.filterDeleted}
            </label>
          )}
        </div>
        {historyError && <RetryNotice message={historyError} onRetry={reload} />}
        {actionError && !dialog && <Notice>{actionError}</Notice>}
        {!history && !historyError && <Spinner />}
        {history && history.length === 0 && <p className="text-slate-600">{tc.noHistory}</p>}
        {history && history.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={tc.historyTitle}>
            {history.map((h) => (
              <li
                key={`${h.kind}:${h.id}`}
                data-testid="cash-history-row"
                className={`flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 ${
                  h.deletedAt ? 'opacity-60' : ''
                }`}
              >
                <StatusBadge tone={h.kind === 'issued' ? 'ok' : 'info'}>{tc.kinds[h.kind]}</StatusBadge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">
                    {h.profileName}{' '}
                    <span className={h.kind === 'issued' ? 'text-ok' : 'text-slate-700'}>
                      {h.kind === 'issued' ? '+' : '−'}
                      {formatSum(h.amount)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(h.at)}
                    {h.kind === 'spent' && ` · ${h.materialName ?? ''} · ${h.objectName ?? ''}`}
                    {h.kind === 'issued' && h.createdByName && ` · ${h.createdByName}`}
                    {h.note && ` · ${h.note}`}
                  </p>
                </div>
                {h.deletedAt && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
                {h.kind === 'issued' && canIssue && !h.deletedAt && (
                  <Button variant="danger" onClick={() => setDialog({ kind: 'delete', entry: h })}>
                    {tc.delete}
                  </Button>
                )}
                {h.kind === 'issued' && canRestore && h.deletedAt && (
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => restoreAdvance(h.id))}>
                    {tc.restore}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === 'issue' && (
        <IssueAdvanceDialog
          companyId={me.company_id}
          recipients={recipients}
          initial={dialog.initial}
          onClose={closeDialog}
          onStale={reload}
          onIssued={(a) => {
            setDialog(null)
            setDone(tc.issued(formatSum(a.amount), a.recipient_name ?? ''))
            reload()
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal title={tc.delete} onClose={closeDialog}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{tc.deleteConfirm}</p>
            <p className="text-xs text-slate-500">{tc.amountLockedHint}</p>
            {actionError && <Notice>{actionError}</Notice>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={closeDialog}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void run(() => softDeleteAdvance(dialog.entry.id))}>
                {tc.deleteOnly}
              </Button>
              <Button disabled={busy} onClick={() => void deleteAndReissue(dialog.entry)}>
                {tc.deleteAndReissue}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
