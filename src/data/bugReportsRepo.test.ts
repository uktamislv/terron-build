// Batch 11 — xatolik xabarlari repo'si (supabase soxta).
import { BUG_MESSAGE_MAX, BUG_SCREEN_MAX, createBugReport, listBugReports, setBugReportStatus } from './bugReportsRepo'
import { RepoError, SERVER_HINTS, toRepoError } from './errors'
import { photoPath } from './photosRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  results: [] as unknown[],
  /** `profile_directory` qatorlari (ismlar ikkinchi so'rovda). */
  people: [] as { id: string; company_id?: string; full_name: string; role: string; is_active?: boolean }[],
}))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args])
          return q
        }
      },
    },
  )
  return q
}

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    from: (table: string) => {
      fake.calls.push(['from', table])
      if (table === 'profile_directory') return fakeQuery(fake.calls, () => ({ data: fake.people, error: null }))
      return fakeQuery(fake.calls, () => fake.results.shift())
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
  fake.people.length = 0
})

const arg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]
const calls = (method: string) => fake.calls.filter((c) => c[0] === method)

describe('createBugReport', () => {
  it('kesadi va tozalaydi; created_by yuborilmaydi (server qo‘yadi); select yo‘q', async () => {
    fake.results.push({ error: null })
    await createBugReport({
      id: 'r1',
      companyId: 'c1',
      message: `  ${'x'.repeat(BUG_MESSAGE_MAX + 10)}  `,
      screen: '/tg/' + 'a'.repeat(300),
      client: '   ',
      appVersion: '1',
      photoPath: null,
    })
    expect(arg('from')).toBe('bug_reports')
    const row = arg('insert') as Record<string, unknown>
    expect(row).toMatchObject({ id: 'r1', company_id: 'c1', client: null, app_version: '1', photo_path: null })
    expect(row).not.toHaveProperty('created_by')
    expect(row).not.toHaveProperty('status')
    expect((row.message as string).length).toBe(BUG_MESSAGE_MAX)
    expect((row.screen as string).length).toBe(BUG_SCREEN_MAX)
    expect(calls('select')).toHaveLength(0)
  })

  it('bo‘sh xabar — serverga bormaydi', async () => {
    await expect(createBugReport({ id: 'r1', companyId: 'c1', message: '  ' })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(fake.calls).toHaveLength(0)
  })

  it('cheklov: 23514 + hint → bug_report_rate_limited va o‘zbekcha matn', async () => {
    fake.results.push({ error: { code: '23514', hint: 'bug_report_rate_limited', message: 'too many' } })
    const err = await createBugReport({ id: 'r1', companyId: 'c1', message: 'Xato' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepoError)
    expect((err as RepoError).code).toBe('bug_report_rate_limited')
    expect(errorText(err)).toBe(t.errors.bug_report_rate_limited)
    expect(SERVER_HINTS.bug_report_rate_limited.showServerMessage).toBe(false)
    expect(toRepoError({ code: '23514', hint: 'bug_report_rate_limited', message: 'x' }).params).toBeNull()
  })

  it('qayta yuborish: shu id allaqachon bor (pkey) — muvaffaqiyat', async () => {
    fake.results.push({ error: { code: '23505', message: 'duplicate key value violates unique constraint "bug_reports_pkey"' } })
    await expect(createBugReport({ id: 'r1', companyId: 'c1', message: 'Xato' })).resolves.toBeUndefined()
  })
})

describe('listBugReports / setBugReportStatus', () => {
  it('filtr, tartib, sahifa; muallif nomi va roli', async () => {
    fake.results.push({
      data: [{ id: 'r1', message: 'm', status: 'yangi', created_by: 'p1' }, { id: 'r2', message: 'n', status: 'yangi', created_by: null }],
      error: null,
      count: 2,
    })
    // Muallif — profile_directory dan (admin bo'lmaganlar profiles dan faqat o'zini ko'radi)
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'prorab' })
    const { rows, total } = await listBugReports({ status: 'yangi' }, 1)
    expect(total).toBe(2)
    expect(rows[0]).toMatchObject({ id: 'r1', author_name: 'Ali', author_role: 'prorab' })
    expect(rows[0]).not.toHaveProperty('author')
    expect(rows[1]).toMatchObject({ author_name: null, author_role: null })
    expect(String(arg('select'))).not.toContain('profiles!')
    expect(fake.calls).toContainEqual(['from', 'profile_directory'])
    expect(fake.calls).toContainEqual(['in', 'id', ['p1']])
    expect(calls('is')[0]).toEqual(['is', 'deleted_at', null])
    expect(calls('eq')[0]).toEqual(['eq', 'status', 'yangi'])
    expect(calls('order')[0]).toEqual(['order', 'created_at', { ascending: false }])
    expect(arg('range')).toBe(50)
  })

  it('holat — faqat status ustuni yangilanadi', async () => {
    fake.results.push({ data: { id: 'r1' }, error: null })
    await setBugReportStatus('r1', 'hal_qilindi')
    expect(arg('update')).toEqual({ status: 'hal_qilindi' })
    expect(calls('eq')[0]).toEqual(['eq', 'id', 'r1'])
  })
})

describe('skrinshot yo‘li', () => {
  it('bug — {company}/bug/{yyyy}/{mm}/{uuid}.{ext} (Toshkent oyi); ops — o‘zgarmagan', () => {
    const company = '00000000-0000-0000-0000-00000000C001'
    const at = new Date('2026-10-31T20:00:00Z') // Toshkentda 01.11.2026
    expect(photoPath(company, 'image/png', at, 'bug')).toMatch(
      /^00000000-0000-0000-0000-00000000c001\/bug\/2026\/11\/[0-9a-f-]{36}\.png$/,
    )
    expect(photoPath(company, 'image/jpeg', at)).toMatch(/^00000000-0000-0000-0000-00000000c001\/2026\/11\/[0-9a-f-]{36}\.jpg$/)
  })

  it('bug_report_invalid — o‘zbekcha matn', () => {
    expect(errorText(toRepoError({ code: '23514', hint: 'bug_report_invalid', message: 'x' }))).toBe(t.errors.bug_report_invalid)
  })
})
