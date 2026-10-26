// tg-auth — Deno Edge Function. Mantiq: ./logic.ts (testlar: ./logic.test.ts).
// verify_jwt = false (supabase/config.toml): Mini App hali sessiyasiz chaqiradi,
// ishonch initData HMAC imzosiga tayanadi.

import { handleTgAuth, InitDataReplayGuard, type TgAuthDeps } from './logic.ts'
import { json, log, preflight, readJson } from '../_shared/http.ts'
import {
  activeCompanyIds,
  createAuthUser,
  createSession,
  deleteAuthUser,
  findAuthUserByEmail,
  getAdminClient,
  getAuthUserEmail,
  getAuthUserIdFromJwt,
  linkAuthUser,
  logAuthEvent,
  profileByTelegramId,
  profileIdByAuthUserId,
} from '../_shared/supabaseAdmin.ts'

const deps: TgAuthDeps = {
  env: { botToken: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? undefined },
  now: () => Date.now(),
  // Izolyat bo'yicha xotirada (cheklov: boshqa izolyat / qayta ishga tushish — ko'rmaydi).
  replayGuard: new InitDataReplayGuard(),
  touchChat: async (chatId) => {
    const { error } = await getAdminClient().rpc('svc_touch_chat', { p_chat_id: chatId })
    if (!error) return
    if (error.code === 'PGRST202') {
      log('warn', "tg-auth: svc_touch_chat hali yo'q")
      return
    }
    throw new Error(`svc_touch_chat: ${error.message}`)
  },
  findProfileByTelegramId: async (telegramUserId: number) => {
    const p = await profileByTelegramId(telegramUserId)
    if (p === null) return null
    const active = await activeCompanyIds([p.company_id])
    return {
      id: p.id,
      company_id: p.company_id,
      role: p.role,
      full_name: p.full_name,
      auth_user_id: p.auth_user_id,
      is_active: p.is_active,
      company_active: active.has(p.company_id),
    }
  },
  getAuthUserEmail,
  getAuthUserIdFromJwt,
  createAuthUser,
  findAuthUserByEmail,
  findProfileIdByAuthUserId: profileIdByAuthUserId,
  deleteAuthUser,
  linkAuthUser,
  createSession,
  logAuthEvent,
  log,
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  try {
    const body = await readJson(req)
    const result = await handleTgAuth(body, deps)
    return json(result.status, result.body)
  } catch (e) {
    log('error', 'tg-auth: kutilmagan xato', { error: e instanceof Error ? e.message : String(e) })
    return json(500, { error: 'internal' })
  }
})
