// Batch 11: "Xatolik haqida xabar berish" (docs/handoff-design.md, 1-bo'lim).
// Jadval `public.bug_reports`: yozish — har bir faol foydalanuvchi (o'z firmasiga, `created_by` ni server
// qo'yadi); o'qish — o'zi yozganlari + admin firmaning hammasini; holat — faqat admin (RLS).
import type { Role } from '@/domain/roles'
import { isPkeyConflict, RepoError, toRepoError } from './errors'
import { updateById } from './rowUpdate'
import { attachNameAndRole } from './profileDirectory'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'

export type BugReportStatus = 'yangi' | 'korildi' | 'hal_qilindi'

export const BUG_REPORT_STATUSES: readonly BugReportStatus[] = ['yangi', 'korildi', 'hal_qilindi']

/** Bazadagi CHECK cheklovlari bilan bir xil. */
export const BUG_MESSAGE_MAX = 2000
export const BUG_SCREEN_MAX = 200
export const BUG_CLIENT_MAX = 500
export const BUG_VERSION_MAX = 50

export const BUG_REPORTS_PAGE_SIZE = 50

export interface BugReport {
  id: string
  company_id: string
  created_by: string | null
  message: string
  screen: string | null
  client: string | null
  app_version: string | null
  photo_path: string | null
  status: BugReportStatus
  created_at: string
  updated_at: string
  author_name: string | null
  author_role: Role | null
}

const BUG_SELECT =
  'id, company_id, created_by, message, screen, client, app_version, photo_path, status, created_at, updated_at'

type RawBugReport = Omit<BugReport, 'author_name' | 'author_role'>

function normalize(raw: RawBugReport): BugReport {
  return { ...raw, author_name: null, author_role: null }
}

/** Muallif ismi va roli — `profile_directory` dan. */
function withAuthors(rows: BugReport[]): Promise<BugReport[]> {
  return attachNameAndRole(rows, 'created_by', 'author_name', 'author_role')
}

function clip(value: string | null | undefined, max: number): string | null {
  const v = value?.trim()
  return v ? v.slice(0, max) : null
}

export interface NewBugReport {
  /** Klient id'si — javob yo'qolib qayta yuborilsa, ikkinchi xabar yaratilmaydi. */
  id: string
  companyId: string
  message: string
  screen?: string | null
  client?: string | null
  appVersion?: string | null
  photoPath?: string | null
}

/**
 * Xabar yuborish. `created_by` ni server yozadi. Cheklov: 10 daqiqada ≤ 5 ta —
 * aks holda `bug_report_rate_limited`.
 */
export async function createBugReport(input: NewBugReport): Promise<void> {
  const message = clip(input.message, BUG_MESSAGE_MAX)
  if (!message) throw new RepoError('invalid_value', 'message required')
  const row = {
    id: input.id,
    company_id: input.companyId,
    message,
    screen: clip(input.screen, BUG_SCREEN_MAX),
    client: clip(input.client, BUG_CLIENT_MAX),
    app_version: clip(input.appVersion, BUG_VERSION_MAX),
    photo_path: clip(input.photoPath, 1000),
  }
  // `select` yo'q: javobni RLS SELECT siyosatiga bog'lamaymiz
  const { error } = await getSupabase().from('bug_reports').insert(row)
  if (error) {
    // Oldingi urinish saqlangan, javob yo'qolgan — muvaffaqiyat
    if (isPkeyConflict(error, 'bug_reports_pkey')) return
    throw toRepoError(error)
  }
}

export interface BugReportFilters {
  /** Berilmasa — barcha holatlar. */
  status?: BugReportStatus
}

/** Admin: firmaning xabarlari, yangisi birinchi, 50 tadan sahifa (0 dan). */
export async function listBugReports(filters: BugReportFilters = {}, page = 0): Promise<{ rows: BugReport[]; total: number }> {
  const from = page * BUG_REPORTS_PAGE_SIZE
  let q = scopeCompany(getSupabase().from('bug_reports').select(BUG_SELECT, { count: 'exact' }).is('deleted_at', null))
  if (filters.status) q = q.eq('status', filters.status)
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, from + BUG_REPORTS_PAGE_SIZE - 1)
  if (error) throw toRepoError(error)
  return { rows: await withAuthors(((data ?? []) as unknown as RawBugReport[]).map(normalize)), total: count ?? 0 }
}

/** Men yuborgan xabarlar (Mini App "Yozuvlarim"), yangisi birinchi. RLS — o'zi yozganlari. */
export async function listMyBugReports(profileId: string, limit = 20): Promise<BugReport[]> {
  const { data, error } = await getSupabase()
    .from('bug_reports')
    .select(BUG_SELECT)
    .eq('created_by', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawBugReport[]).map(normalize)
}

/** Holatni o'zgartirish — faqat admin (RLS). */
export function setBugReportStatus(id: string, status: BugReportStatus): Promise<void> {
  return updateById('bug_reports', id, { status })
}
