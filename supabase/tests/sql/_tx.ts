// ============================================================================
// Tranzaksiya ichidagi umumiy test yordamchilari (asUser ichida): rolni vaqtincha
// postgres'ga almashtirish, triggerlarsiz yozish, foydalanuvchini almashtirish va
// natijani `OK:<n>` / `<errcode>:<hint>` ko'rinishida olish.
// audit_fixes / audit2_fixes testlaridagi uslub bilan bir xil.
// ============================================================================

import { one, type Queryable, type Tx } from './_harness'

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
export async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint tx_res')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint tx_res')
    return `OK:${r.affectedRows || r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint tx_res')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Shu tranzaksiyada postgres sifatida (RLS'siz); JWT claims saqlanadi. */
export async function sys<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Tizim konteksti: postgres va claims'siz (auth.uid() = null). */
export async function system<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const saved = await one<{ c: string; s: string }>(
    tx,
    `select coalesce(current_setting('request.jwt.claims', true), '') c, coalesce(current_setting('request.jwt.claim.sub', true), '') s`,
  )
  await tx.exec('reset role')
  await tx.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`)
  try {
    return await fn()
  } finally {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [saved.c, saved.s])
    await tx.exec('set local role authenticated')
  }
}

/** Triggerlarsiz (session_replication_role = replica), postgres sifatida. */
export async function raw(tx: Tx, sql: string, params: unknown[] = []): Promise<void> {
  await sys(tx, async () => {
    await tx.exec('set local session_replication_role = replica')
    try {
      await tx.query(sql, params)
    } finally {
      await tx.exec('set local session_replication_role = origin')
    }
  })
}

/** Shu tranzaksiyada boshqa foydalanuvchi (auth uid) nomidan davom etish. */
export async function switchUid(tx: Tx, uid: string): Promise<void> {
  await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' }),
    uid,
  ])
}
