import { compressImage, fitSize, type ImageDeps } from './image'

function fakeDeps(width: number, height: number, out: Blob | null = new Blob(['jpg'], { type: 'image/jpeg' })) {
  const calls = { canvas: [] as [number, number][], draw: [] as unknown[][], toBlob: [] as unknown[][], closed: 0 }
  const deps: ImageDeps = {
    decode: vi.fn(async () => ({ width, height, source: {} as CanvasImageSource, close: () => void calls.closed++ })),
    createCanvas: (w, h) => {
      calls.canvas.push([w, h])
      return {
        getContext: () => ({ drawImage: (...args: unknown[]) => void calls.draw.push(args) }) as never,
        toBlob: (cb, type, quality) => {
          calls.toBlob.push([type, quality])
          cb(out)
        },
      }
    },
  }
  return { deps, calls }
}

describe('fitSize', () => {
  it('eng uzun tomon maxSide gacha, proporsiya saqlanadi; kichigi kattalashmaydi', () => {
    expect(fitSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })
})

describe('compressImage', () => {
  it('kichraytirib JPEG 0.8 ga aylantiradi', async () => {
    const { deps, calls } = fakeDeps(4000, 3000)
    const result = await compressImage(new Blob(['raw'], { type: 'image/png' }), { maxSide: 1600, quality: 0.8 }, deps)
    expect(result.type).toBe('image/jpeg')
    expect(calls.canvas).toEqual([[1600, 1200]])
    expect(calls.draw[0]?.slice(1)).toEqual([0, 0, 1600, 1200])
    expect(calls.toBlob).toEqual([['image/jpeg', 0.8]])
    expect(calls.closed).toBe(1)
  })

  it('dekodlab bo‘lmasa — asl fayl', async () => {
    const file = new Blob(['x'], { type: 'image/heic' })
    const deps: ImageDeps = { decode: vi.fn(async () => Promise.reject(new Error('no'))), createCanvas: vi.fn() }
    expect(await compressImage(file, {}, deps)).toBe(file)
  })

  it('canvas blob bermasa — asl fayl', async () => {
    const file = new Blob(['x'], { type: 'image/jpeg' })
    const { deps } = fakeDeps(100, 100, null)
    expect(await compressImage(file, {}, deps)).toBe(file)
  })
})

describe('preparePhoto', () => {
  it('siqilgan JPEG — ok', async () => {
    const { preparePhoto } = await import('./image')
    const { deps } = fakeDeps(4000, 3000)
    const r = await preparePhoto(new Blob(['raw'], { type: 'image/png' }), {}, deps)
    expect(r.ok && r.blob.type).toBe('image/jpeg')
  })

  it('ochib bo‘lmaydigan HEIC — photo_type', async () => {
    const { preparePhoto } = await import('./image')
    const deps: ImageDeps = { decode: vi.fn(async () => Promise.reject(new Error('no'))), createCanvas: vi.fn() }
    expect(await preparePhoto(new Blob(['x'], { type: 'image/heic' }), {}, deps)).toEqual({ ok: false, reason: 'photo_type' })
  })

  it('siqib bo‘lmadi, asl JPEG 5 MB dan katta — photo_too_large', async () => {
    const { preparePhoto, PHOTO_MAX_BYTES } = await import('./image')
    const deps: ImageDeps = { decode: vi.fn(async () => Promise.reject(new Error('no'))), createCanvas: vi.fn() }
    const big = new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)], { type: 'image/jpeg' })
    expect(await preparePhoto(big, {}, deps)).toEqual({ ok: false, reason: 'photo_too_large' })
  })

  it('siqib bo‘lmadi, asl JPEG kichik — asl fayl ishlatiladi', async () => {
    const { preparePhoto } = await import('./image')
    const file = new Blob(['x'], { type: 'image/jpeg' })
    const deps: ImageDeps = { decode: vi.fn(async () => Promise.reject(new Error('no'))), createCanvas: vi.fn() }
    expect(await preparePhoto(file, {}, deps)).toEqual({ ok: true, blob: file })
  })
})
