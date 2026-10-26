import { generatePassword } from '@/lib/password'
import { assignableRoles, validateLoginForm, validateUserForm } from './userForm'

describe('validateUserForm', () => {
  it('bo‘sh forma — ism, telefon, rol majburiy', () => {
    const r = validateUserForm({ fullName: ' ', phone: '', role: '', objectIds: [] }, 'admin')
    expect(r).toEqual({ ok: false, errors: { fullName: 'required', phone: 'required', role: 'required' } })
  })

  it('noto‘g‘ri telefon', () => {
    const r = validateUserForm({ fullName: 'Ali', phone: '12345', role: 'omborchi', objectIds: ['o1'] }, 'admin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.phone).toBe('invalid')
  })

  it('prorab obyektsiz — xato; haydovchi obyektsiz — mumkin', () => {
    const base = { fullName: 'Ali', phone: '90 123 45 67', objectIds: [] }
    const prorab = validateUserForm({ ...base, role: 'prorab' }, 'admin')
    expect(prorab.ok).toBe(false)
    if (!prorab.ok) expect(prorab.errors.objectIds).toBe('required')
    expect(validateUserForm({ ...base, role: 'haydovchi' }, 'admin').ok).toBe(true)
  })

  it('to‘g‘ri forma — telefon normallashtiriladi, firma rolida obyektlar tashlanadi', () => {
    const r = validateUserForm(
      { fullName: '  Ali   Valiyev ', phone: '+998 (90) 123-45-67', role: 'direktor', objectIds: ['o1'] },
      'admin',
    )
    expect(r).toEqual({
      ok: true,
      value: { fullName: 'Ali Valiyev', phone: '+998901234567', role: 'direktor', objectIds: [] },
    })
  })

  it('admin super_admin rolini bera olmaydi', () => {
    expect(assignableRoles('admin')).not.toContain('super_admin')
    expect(assignableRoles('super_admin')).toContain('super_admin')
    const r = validateUserForm({ fullName: 'X', phone: '901234567', role: 'super_admin', objectIds: [] }, 'admin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.role).toBe('invalid')
  })
})

describe('validateLoginForm', () => {
  it('email ixtiyoriy, parol ≥ 10', () => {
    expect(validateLoginForm('', '1234567890')).toEqual({})
    expect(validateLoginForm('yomon', '123456789')).toEqual({ email: 'invalid', password: 'invalid' })
    expect(validateLoginForm('a@b.uz', 'uzun-parol')).toEqual({})
  })
})

describe('generatePassword', () => {
  it('14 belgi, har xil turdagi belgilar, har safar boshqa', () => {
    const a = generatePassword()
    expect(a).toHaveLength(14)
    expect(a).toMatch(/[a-z]/)
    expect(a).toMatch(/[A-Z]/)
    expect(a).toMatch(/[0-9]/)
    expect(a).toMatch(/[!@#$%*\-_+?]/)
    expect(generatePassword()).not.toBe(a)
    expect(generatePassword(4)).toHaveLength(8)
  })
})
