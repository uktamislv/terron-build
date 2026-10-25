// Tarix (Batch 10): audit_log.action → UI dagi amal turi (belgi va rang uchun).

export type ActionKind = 'create' | 'update' | 'delete' | 'restore' | 'auth'

const ACTIONS: Readonly<Record<string, ActionKind>> = {
  INSERT: 'create',
  UPDATE: 'update',
  SOFT_DELETE: 'delete',
  RESTORE: 'restore',
  SET_LOGIN: 'auth',
  TG_LINK: 'auth',
  TG_AUTH_USER_CREATED: 'auth',
}

/** Auth hodisalari (Batch 2, `svc_log_auth_event`). */
export const AUTH_ACTIONS: readonly string[] = Object.freeze(['SET_LOGIN', 'TG_LINK', 'TG_AUTH_USER_CREATED'])

/** audit_log.action qiymati → amal turi. Noma'lum — `update`. */
export function actionKind(action: string): ActionKind {
  return Object.hasOwn(ACTIONS, action) ? (ACTIONS[action] as ActionKind) : 'update'
}
