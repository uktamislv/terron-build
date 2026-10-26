// admin-users — Deno Edge Function. Mantiq: ./logic.ts (testlar: ./logic.test.ts).
// verify_jwt = false (supabase/config.toml): chaqiruvchini funksiyaning o'zi
// auth.getUser(jwt) bilan tekshiradi (yangi JWT signing keys bilan ham ishlaydi);
// JWT yo'q / yaroqsiz / anon kalit → 401.

import { handleAdminUsers, type AdminUsersDeps } from './logic.ts'
import { json, log, preflight, readJson } from '../_shared/http.ts'
import {
  activeProfileByAuthUserId,
  createAuthUser,
  deleteAuthUser,
  findAuthUserByEmail,
  getAdminClient,
  getAuthUserIdFromJwt,
  lastProfileCompanyByAuthUserId,
  linkAuthUser,
  logAuthEvent,
  profileById,
  profileIdByAuthUserId,
  setLoginKind,
  updateAuthUser,
} from '../_shared/supabaseAdmin.ts'

const deps: AdminUsersDeps = {
  alertLoginSet: async (targetProfileId, actorProfileId) => {
    const { error } = await getAdminClient().rpc('svc_alert_login_set', {
      p_target_profile: targetProfileId,
      p_actor: actorProfileId,
    })
    if (error) {
      const hint = error.hint === 'login_target_not_found' ? ' (login_target_not_found)' : ''
      throw new Error(`svc_alert_login_set${hint}: ${error.message}`)
    }
  },
  getAuthUserIdFromJwt,
  getActiveProfileByAuthUserId: async (authUserId: string) => {
    const p = await activeProfileByAuthUserId(authUserId)
    return p === null ? null : { id: p.id, company_id: p.company_id, role: p.role }
  },
  getProfileById: async (profileId: string) => {
    const p = await profileById(profileId)
    return p === null
      ? null
      : { id: p.id, company_id: p.company_id, role: p.role, phone: p.phone, auth_user_id: p.auth_user_id }
  },
  createAuthUser,
  updateAuthUser,
  findAuthUserByEmail,
  findProfileIdByAuthUserId: profileIdByAuthUserId,
  deleteAuthUser,
  linkAuthUser,
  lastProfileCompanyByAuthUserId,
  setLoginKind,
  logAuthEvent,
  log,
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  try {
    const body = await readJson(req)
    const result = await handleAdminUsers(req.headers.get('Authorization'), body, deps)
    return json(result.status, result.body)
  } catch (e) {
    // Xabarda parol bo'lmaydi: logic.ts parolni hech qayerga uzatmaydi.
    log('error', 'admin-users: kutilmagan xato', { error: e instanceof Error ? e.message : String(e) })
    return json(500, { error: 'internal' })
  }
})
