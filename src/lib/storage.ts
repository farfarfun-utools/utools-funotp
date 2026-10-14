// uTools 内走 dbStorage，浏览器预览时退回 localStorage。
// 统一从这里读写，避免同一份数据一半在 dbStorage、一半在 localStorage。
function db() {
  return window.utools?.dbStorage || null
}

function readLocal<T>(key: string, fallback: T | null): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** 从 uTools 数据库或浏览器本地存储读取数据，并迁移旧的 localStorage 数据。
 * @param key 存储键名。
 * @param fallback 未找到或读取失败时返回的值。
 * @returns 已读取的数据或后备值。
 */
export function readStorage<T>(key: string, fallback: T | null = null): T | null {
  const store = db()
  if (!store) return readLocal(key, fallback)
  const value = store.getItem(key)
  if (value != null) return value as T
  const legacy = readLocal(key, null)
  if (legacy == null) return fallback
  store.setItem(key, legacy)
  localStorage.removeItem(key)
  return legacy
}

// dbStorage 落在 uTools 文档数据库上，单个文档上限 1MB。
// 超了 setItem 会直接抛错，提前拦一下才能给出用户看得懂的提示。
const MAX_DOC_BYTES = 1024 * 1024

// 每次写入都 new 一个 TextEncoder 没有意义，它是无状态的。
const encoder = new TextEncoder()

// 超出上限时返回实际体积，没超返回 0。
// 一个 UTF-16 码元在 UTF-8 里最多占 3 字节（代理对是 2 个码元换 4 字节，更省），
// 所以字符数不到上限三分之一时必然没超——这是绝大多数情况，可以直接跳过编码，
// 省掉为了拿一个长度而拷出来的那份跟数据等大的 Uint8Array。
function overLimitBytes(text: string): number {
  if (text.length * 3 <= MAX_DOC_BYTES) return 0
  const bytes = encoder.encode(text).length
  return bytes > MAX_DOC_BYTES ? bytes : 0
}

/** 将可序列化数据写入 uTools 数据库或浏览器本地存储。
 * @param key 存储键名。
 * @param value 要保存的可序列化数据。
 * @returns 无返回值。
 * @throws 数据无法 JSON 序列化，或超出 uTools 单条数据 1MB 上限时抛出错误。
 */
export function writeStorage(key: string, value: unknown): void {
  // dbStorage 不接受 Vue 的响应式代理，序列化一次既摊平成纯数据又能量出体积。
  const text = JSON.stringify(value)
  const bytes = overLimitBytes(text)
  if (bytes) {
    throw new Error(`数据已达 ${Math.round(bytes / 1024)}KB，超出 uTools 单条数据 1MB 上限，请先精简备注或清空废纸篓`)
  }
  const store = db()
  if (store) store.setItem(key, JSON.parse(text))
  else localStorage.setItem(key, text)
}
