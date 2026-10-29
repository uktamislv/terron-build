import { importWithReload } from './lazyWithReload'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/Page-abc.js')

describe('importWithReload (audit 3, E5)', () => {
  it('muvaffaqiyat — modul qaytadi, reload yo‘q', async () => {
    const reload = vi.fn()
    expect(await importWithReload(async () => ({ a: 1 }), reload, () => true)()).toEqual({ a: 1 })
    expect(reload).not.toHaveBeenCalled()
  })

  it('chunk xatosi, birinchi marta — reload, va’da tugamaydi', async () => {
    const reload = vi.fn()
    const p = importWithReload(() => Promise.reject(chunkError()), reload, () => true)()
    const settled = await Promise.race([p.then(() => 'done', () => 'failed'), new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(settled).toBe('pending')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('chunk xatosi, allaqachon urinilgan — xato qayta tashlanadi (ErrorBoundary)', async () => {
    const reload = vi.fn()
    await expect(importWithReload(() => Promise.reject(chunkError()), reload, () => false)()).rejects.toThrow(/dynamically imported/)
    expect(reload).not.toHaveBeenCalled()
  })

  it('boshqa xato — reload yo‘q, bayroq olinmaydi', async () => {
    const reload = vi.fn()
    const claim = vi.fn(() => true)
    await expect(importWithReload(() => Promise.reject(new Error('boom')), reload, claim)()).rejects.toThrow('boom')
    expect(reload).not.toHaveBeenCalled()
    expect(claim).not.toHaveBeenCalled()
  })
})
