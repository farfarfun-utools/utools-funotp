// jsqr 和 qrcode 加起来约 155KB（gzip 57KB），是整个 bundle 的一半，
// 但扫码添加和导出二维码都是「用户点一下才发生」的操作，不该挡在插件启动路径上。
// 所以这两个库只在真正要用的时候 import()，各自落成一个独立 chunk。
// 这三个导出本来就是 Promise 形式，调用方不用改。

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法读取'))
    image.src = source
  })
}

// jsqr 只在用的时候才 import，这里借它的类型给下面的 scan 用。
type JsQr = (typeof import('jsqr'))['default']

// 画到 canvas 上再把像素交给 jsQR。同一次识别里复用一个 canvas，不必每档都新建一个。
function scan(jsQR: JsQr, canvas: HTMLCanvasElement, image: HTMLImageElement, scale: number) {
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  if (!canvas.width || !canvas.height) return null
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.imageSmoothingEnabled = scale < 1
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data || null
}

// 放大一倍只对本来就不大的图才试。4K 整屏截图放大后，单次 ImageData 就是
// 7680×4320×4 ≈ 132MB，而放大并不会给 jsQR 增加任何信息量。
const UPSCALE_MAX_EDGE = 1000

/** 从图片地址或 data URL 中识别二维码文本。
 * @param source 图片地址或 data URL。
 * @returns 识别出的二维码文本。
 * @throws 图片无法读取或不含二维码时抛出错误。
 */
export async function decodeQrImage(source: string): Promise<string> {
  const { default: jsQR } = await import('jsqr')
  const image = await loadImage(source)
  // 原尺寸优先：像素不动，小二维码也不会被缩没。失败再降一半，糊掉的大图有时反而更好认。
  const edge = Math.max(image.naturalWidth, image.naturalHeight)
  const scales = edge <= UPSCALE_MAX_EDGE ? [1, 2, 0.5] : [1, 0.5]
  const canvas = document.createElement('canvas')
  for (const scale of scales) {
    const result = scan(jsQR, canvas, image, scale)
    if (result) return result
  }
  throw new Error('没有识别到二维码，请让二维码更清晰一些')
}

/** 将文本生成二维码 data URL。
 * @param text 要编码的文本。
 * @param dark 二维码前景色。
 * @returns 二维码 PNG 的 data URL。
 */
export async function toQrDataUrl(text: string, dark: string = '#2f3437'): Promise<string> {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark, light: '#ffffff' },
  })
}

// 剪贴板里的图片走 navigator.clipboard，uTools 与浏览器预览下都能用。
/** 读取剪贴板中的第一张图片并转换为 data URL。
 * @returns 图片 data URL。
 * @throws 剪贴板没有图片或图片读取失败时抛出错误。
 */
export async function readClipboardImage(): Promise<string> {
  const items = await navigator.clipboard?.read?.()
  for (const item of items || []) {
    const type = item.types.find(value => value.startsWith('image/'))
    if (!type) continue
    const blob = await item.getType(type)
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      // 不接 onerror 的话读取失败就是一个永远不 settle 的 Promise，界面会一直停在「正在识别剪贴板…」。
      reader.onerror = () => reject(new Error('剪贴板里的图片无法读取'))
      reader.readAsDataURL(blob)
    })
  }
  throw new Error('剪贴板里没有图片')
}
