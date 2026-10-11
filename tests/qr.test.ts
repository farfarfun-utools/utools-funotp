import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

vi.mock('jsqr', () => ({ default: () => ({ data: 'otpauth://totp/Acme:me?secret=JBSWY3DPEHPK3PXP' }) }))

import { decodeQrImage, readClipboardImage, toQrDataUrl } from '../src/lib/qr'

afterEach(() => vi.unstubAllGlobals())

test('生成二维码 data URL', async () => {
  const url = await toQrDataUrl('otpauth://totp/Acme:me?secret=JBSWY3DPEHPK3PXP')
  assert.match(url, /^data:image\/png;base64,/)
})

test('识别已加载图片中的二维码文本', async () => {
  class ImageMock {
    naturalWidth = 1
    naturalHeight = 1
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_source: string) { this.onload?.() }
  }
  vi.stubGlobal('Image', ImageMock)
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) }),
    }),
  })
  assert.match(await decodeQrImage('data:image/png;base64,test'), /^otpauth:\/\//)
})

test('图片无法读取和空剪贴板会给出明确错误', async () => {
  class BrokenImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_source: string) { this.onerror?.() }
  }
  vi.stubGlobal('Image', BrokenImage)
  vi.stubGlobal('navigator', { clipboard: { read: async () => [] } })
  await assert.rejects(() => decodeQrImage('bad'), /图片无法读取/)
  await assert.rejects(() => readClipboardImage(), /剪贴板里没有图片/)
})
