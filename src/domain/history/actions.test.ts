import { describe, expect, it } from 'vitest'
import { actionKind, AUTH_ACTIONS } from './actions'

describe('actionKind', () => {
  it.each([
    ['INSERT', 'create'],
    ['UPDATE', 'update'],
    ['SOFT_DELETE', 'delete'],
    ['RESTORE', 'restore'],
    ['SET_LOGIN', 'auth'],
    ['TG_LINK', 'auth'],
    ['TG_AUTH_USER_CREATED', 'auth'],
  ])('%s → %s', (action, kind) => {
    expect(actionKind(action)).toBe(kind)
  })

  it("noma'lum → update", () => {
    expect(actionKind('')).toBe('update')
    expect(actionKind('insert')).toBe('update')
    expect(actionKind('DELETE')).toBe('update')
    expect(actionKind('constructor')).toBe('update')
    expect(actionKind('__proto__')).toBe('update')
  })

  it('AUTH_ACTIONS hammasi auth', () => {
    for (const a of AUTH_ACTIONS) expect(actionKind(a)).toBe('auth')
  })
})
