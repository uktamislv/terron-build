import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { HandCoins, History, Pencil, Plus, RotateCcw, Trash2, Undo2, UserRound, Wallet } from 'lucide-react'
import { Badge, Button, DataTable, DetailRows, DetailSheet, EmptyState, EntryRow, FilterBar, Modal, Money, Notice, PageHeader, RetryNotice, Spinner, TextAreaField } from '@/components/ui'
import {
  emptyBalance,
  listAllCashHistory,
  listBalances,
  listCashHistory,
  restoreAdvance,
  softDeleteAdvance,
  updateAdvanceNote,
  type CashHistoryEntry,
} from '@/data/cashRepo'
import { listDirectory } from '@/data/profileDirectory'
import type { CashBalance, PersonRef } from '@/data/types'
import { isNegative, isZero } from '@/domain/decimal'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDate, formatDateTime, formatSum } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { cashSheets } from '../exports'
import { IssueAdvanceDialog } from '../cash/IssueAdvanceDialog'

const tc = t.cash

type Tone = 'negative' | 'zero' | 'positive'

/** Qo'limdagi pul rangi: manfiy — qizil, nol — kulrang, musbat — yashil. */
function balanceTone(balance: string): Tone {
  if (isNegative(balance)) return 'negative'
  return isZero(balance) ? 'zero' : 'positive'
}

function lastActivity(b: CashBalance): string | null {
  const dates = [b.last_issued_at, b.last_spent_at].filter((x): x is string => Boolean(x))
  if (dates.length === 0) return null
  return dates.reduce((a, c) => (Date.parse(c) > Date.parse(a) ? c : a))
}

type Dialog =
  | { kind: 'issue'; initial?: { recipientId: string; amount: string; note: string | null } }
  | { kind: 'giveBack' }
  | { kind: 'delete'; entry: CashHistoryEntry }
  | { kind: 'detail'; entry: CashHistoryEntry }
  | { kind: 'note'; entry: CashHistoryEntry }
  | null

/** Podotchet: odamlar bo'yicha qo'limdagi pul, pul berish, tarix. */
export function CashPage() {
  const { profile: me } = useAuth()
  const [profiles, setProfiles] = useState<PersonRef[]>([])
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
    listDirectory()
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
    const people = new Map<string, PersonRef>()
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

  const runExport = async (signal: AbortSignal) => {
    const [all, entries] = await Promise.all([
      listBalances(),
      listAllCashHistory({ profileId: personId || undefined, includeDeleted: canSeeDeleted && includeDeleted }, signal),
    ])
    const names = new Map(profiles.map((p) => [p.id, p.full_name]))
    const named = all
      .filter((b) => !personId || b.profile_id === personId)
      .map((b) => ({ ...b, name: names.get(b.profile_id) ?? '—' }))
      .sort((a, b) => a.name.localeCompare(b.name))
    await exportWorkbook({ fileName: exportFileName(t.excel.sections.cash), sheets: cashSheets(named, entries), signal })
  }

  const balanceMoney = (balance: string, size: 'sm' | 'lg') => {
    const tone = balanceTone(balance)
    return (
      <span data-tone={tone} title={tone === 'negative' ? tc.negativeHint : undefined}>
        <Money value={balance} size={size} tone={tone === 'positive' ? 'ok' : tone === 'zero' ? 'muted' : undefined} />
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tc.title}
        icon={<Wallet strokeWidth={1.75} />}
        actions={
          <>
            <ExportButton run={runExport} />
            {canIssue && (
              <Button
                icon={<Plus aria-hidden className="size-5" strokeWidth={1.75} />}
                onClick={() => {
                  setDone(null)
                  setDialog({ kind: 'issue' })
                }}
              >
                {tc.issue}
              </Button>
            )}
          </>
        }
        secondaryActions={[
          canIssue && {
            key: 'giveBack',
            label: tc.giveBack,
            icon: <Undo2 aria-hidden className="size-5" strokeWidth={1.75} />,
            onSelect: () => {
              setDone(null)
              setDialog({ kind: 'giveBack' })
            },
          },
        ]}
      />
      {done && <Notice tone="ok">{done}</Notice>}

      <section className="flex flex-col gap-3" aria-label={tc.balancesTitle}>
        <h2 className="text-lg font-semibold text-ink md:text-xl">{tc.balancesTitle}</h2>
        {balanceError && <RetryNotice message={balanceError} onRetry={reload} />}
        {!balances && !balanceError && <Spinner />}
        {balances && (
          <DataTable
            caption={tc.balancesTitle}
            rows={rows}
            rowKey={(r) => r.profile.id}
            rowTestId="balance-row"
            empty={<EmptyState icon={<Wallet strokeWidth={1.5} />} title={tc.noBalances} />}
            columns={[
              { key: 'person', header: tc.colPerson, cell: ({ profile }) => <span className="font-medium text-ink">{profile.full_name}</span> },
              { key: 'role', header: tc.colRole, cell: ({ profile }) => <span className="text-muted">{t.roles[profile.role]}</span> },
              { key: 'issued', header: tc.colIssued, align: 'right', cell: ({ balance }) => <Money value={balance.issued_total} size="sm" /> },
              { key: 'returned', header: tc.colReturned, align: 'right', cell: ({ balance }) => <Money value={balance.returned_total ?? '0'} size="sm" /> },
              { key: 'spent', header: tc.colSpent, align: 'right', cell: ({ balance }) => <Money value={balance.spent_total} size="sm" /> },
              { key: 'balance', header: tc.colBalance, align: 'right', cell: ({ balance }) => balanceMoney(balance.balance, 'sm') },
              {
                key: 'last',
                header: tc.colLast,
                cell: ({ balance }) => {
                  const last = lastActivity(balance)
                  return <span className="tabular text-muted">{last ? formatDate(last) : '—'}</span>
                },
              },
            ]}
            renderMobile={({ profile, balance }) => {
              const last = lastActivity(balance)
              const tone = balanceTone(balance.balance)
              return (
                <EntryRow
                  kind={tone === 'negative' ? 'danger' : tone === 'positive' ? 'ok' : 'neutral'}
                  icon={<UserRound className="size-[18px]" strokeWidth={1.75} />}
                  title={profile.full_name}
                  meta={
                    <>
                      <span>{t.roles[profile.role]}</span>
                      <span>
                        {tc.colIssued}: <Money value={balance.issued_total} size="sm" className="[&_span]:text-xs [&_span]:font-normal" />
                      </span>
                      <span>
                        {tc.colSpent}: <Money value={balance.spent_total} size="sm" className="[&_span]:text-xs [&_span]:font-normal" />
                      </span>
                      {last && <span className="tabular">{formatDate(last)}</span>}
                    </>
                  }
                  trailing={balanceMoney(balance.balance, 'lg')}
                  trailingMeta={tc.colBalance}
                />
              )
            }}
          />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label={tc.historyTitle}>
        <h2 className="text-lg font-semibold text-ink md:text-xl">{tc.historyTitle}</h2>
        <FilterBar
          label={t.ombor.filters}
          onClear={() => {
            setPersonId('')
            setIncludeDeleted(false)
          }}
          filters={[
            {
              kind: 'select',
              key: 'person',
              label: tc.filterPerson,
              value: personId,
              onChange: setPersonId,
              options: [{ value: '', label: tc.all }, ...profiles.map((p) => ({ value: p.id, label: p.full_name }))],
            },
            ...(canSeeDeleted
              ? [{ kind: 'toggle' as const, key: 'deleted', label: tc.filterDeleted, checked: includeDeleted, onChange: setIncludeDeleted }]
              : []),
          ]}
        />
        {historyError && <RetryNotice message={historyError} onRetry={reload} />}
        {actionError && !dialog && <Notice>{actionError}</Notice>}
        {!history && !historyError && <Spinner />}
        {history && history.length === 0 && <EmptyState compact icon={<History strokeWidth={1.5} />} title={tc.noHistory} />}
        {history && history.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={tc.historyTitle}>
            {history.map((h) => (
              <EntryRow
                key={`${h.kind}:${h.id}`}
                as="li"
                testId="cash-history-row"
                kind={h.kind === 'issued' ? 'ok' : h.kind === 'returned' ? 'neutral' : 'xarid'}
                icon={
                  h.kind === 'issued' ? (
                    <HandCoins className="size-[18px]" strokeWidth={1.75} />
                  ) : h.kind === 'returned' ? (
                    <Undo2 className="size-[18px]" strokeWidth={1.75} />
                  ) : undefined
                }
                deleted={Boolean(h.deletedAt)}
                title={h.profileName}
                badge={
                  <>
                    <Badge tone={h.kind === 'issued' ? 'ok' : h.kind === 'returned' ? 'neutral' : 'info'}>{tc.kinds[h.kind]}</Badge>
                    {h.deletedAt && <Badge tone="danger">{t.movements.deleted}</Badge>}
                  </>
                }
                meta={
                  <>
                    <span className="tabular">{formatDateTime(h.at)}</span>
                    {h.kind === 'spent' && (h.materialName || h.objectName) && (
                      <span>{[h.materialName, h.objectName].filter(Boolean).join(', ')}</span>
                    )}
                    {h.kind !== 'spent' && h.createdByName && <span>{h.createdByName}</span>}
                    {h.note && <span className="text-ink/80">{h.note}</span>}
                  </>
                }
                trailing={
                  <span className={`tabular inline-flex items-baseline ${h.kind === 'issued' ? 'text-ok' : 'text-ink'}`}>
                    <span className="text-base font-semibold">{h.kind === 'issued' ? '+' : '−'}</span>
                    <Money value={h.amount} tone={h.kind === 'issued' ? 'ok' : undefined} />
                  </span>
                }
                onClick={() => setDialog({ kind: 'detail', entry: h })}
              />
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
      {dialog?.kind === 'giveBack' && (
        <IssueAdvanceDialog
          companyId={me.company_id}
          recipients={recipients}
          kind="qaytarildi"
          onClose={closeDialog}
          onStale={reload}
          onIssued={(a) => {
            setDialog(null)
            setDone(tc.returnedDone(formatSum(a.amount), a.recipient_name ?? ''))
            reload()
          }}
        />
      )}
      {dialog?.kind === 'detail' && (
        <DetailSheet
          title={dialog.entry.profileName ?? t.ui.details}
          onClose={closeDialog}
          footer={
            dialog.entry.kind !== 'spent' &&
            (canIssue && !dialog.entry.deletedAt ? (
              <>
                {/* Summa va sana o'zgarmaydi (cash_amount_locked) — faqat izoh */}
                <Button
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                  icon={<Pencil aria-hidden className="size-5" strokeWidth={1.75} />}
                  onClick={() => {
                    setActionError(null)
                    setDialog({ kind: 'note', entry: dialog.entry })
                  }}
                >
                  {tc.editNote}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1 sm:flex-none"
                  icon={<Trash2 aria-hidden className="size-5" strokeWidth={1.75} />}
                  onClick={() => setDialog({ kind: 'delete', entry: dialog.entry })}
                >
                  {tc.delete}
                </Button>
              </>
            ) : canRestore && dialog.entry.deletedAt ? (
              <Button
                variant="secondary"
                className="flex-1 sm:flex-none"
                icon={<RotateCcw aria-hidden className="size-5" strokeWidth={1.75} />}
                loading={busy}
                onClick={() => {
                  const id = dialog.entry.id
                  void run(() => restoreAdvance(id))
                }}
              >
                {tc.restore}
              </Button>
            ) : null)
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={dialog.entry.kind === 'issued' ? 'ok' : 'info'}>{tc.kinds[dialog.entry.kind]}</Badge>
              {dialog.entry.deletedAt && <Badge tone="danger">{t.movements.deleted}</Badge>}
            </div>
            <Money value={dialog.entry.amount} size="hero" tone={dialog.entry.kind === 'issued' ? 'ok' : undefined} />
            <DetailRows
              items={[
                { label: t.ombor.colDate, value: <span className="tabular">{formatDateTime(dialog.entry.at)}</span> },
                dialog.entry.kind === 'spent' && dialog.entry.materialName ? { label: t.ombor.colMaterial, value: dialog.entry.materialName } : null,
                dialog.entry.kind === 'spent' && dialog.entry.objectName ? { label: t.ombor.colObject, value: dialog.entry.objectName } : null,
                dialog.entry.kind !== 'spent' && dialog.entry.createdByName ? { label: t.ombor.colUser, value: dialog.entry.createdByName } : null,
                dialog.entry.note ? { label: t.ombor.colNote, value: dialog.entry.note } : null,
              ]}
            />
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </DetailSheet>
      )}
      {dialog?.kind === 'note' && (
        <NoteDialog
          initial={dialog.entry.note ?? ''}
          busy={busy}
          error={actionError}
          onClose={closeDialog}
          onSave={(note) => {
            const id = dialog.entry.id
            void run(() => updateAdvanceNote(id, note))
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal
          title={tc.delete}
          onClose={closeDialog}
          footer={
            <>
              <Button variant="secondary" onClick={closeDialog}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void run(() => softDeleteAdvance(dialog.entry.id))}>
                {tc.deleteOnly}
              </Button>
              {dialog.entry.kind === 'issued' && (
                <Button disabled={busy} onClick={() => void deleteAndReissue(dialog.entry)}>
                  {tc.deleteAndReissue}
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{tc.deleteConfirm}</p>
            <p className="text-xs text-muted">{tc.amountLockedHint}</p>
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </div>
  )
}

/** Podotchet izohini tahrirlash (admin, buxgalter). Summa va sana o'zgarmaydi. */
function NoteDialog({
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  initial: string
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (note: string) => void
}) {
  const [note, setNote] = useState(initial)
  return (
    <Modal
      title={t.cash.editNote}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button loading={busy} onClick={() => onSave(note)}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t.cash.editNoteHint}</p>
        <TextAreaField label={t.cash.note} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}
