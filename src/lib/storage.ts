// uTools 内走 dbStorage，浏览器预览时退回 localStorage。
// 统一从这里读写，避免同一份数据一半在 dbStorage、一半在 localStorage。
function db() {
  return window.utools?.dbStorage || null
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function readStorage(key, fallback = null) {
  const store = db()
  if (!store) return readLocal(key, fallback)
  const value = store.getItem(key)
  if (value != null) return value
  const legacy = readLocal(key, null)
  if (legacy == null) return fallback
  store.setItem(key, legacy)
  localStorage.removeItem(key)
  return legacy
}

// dbStorage 落在 uTools 文档数据库上，单个文档上限 1MB。
// 超了 setItem 会直接抛错，提前拦一下才能给出用户看得懂的提示。
const MAX_DOC_BYTES = 1024 * 1024

export function writeStorage(key, value) {
  // dbStorage 不接受 Vue 的响应式代理，序列化一次既摊平成纯数据又能量出体积。
  const text = JSON.stringify(value)
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_DOC_BYTES) {
    throw new Error(`数据已达 ${Math.round(bytes / 1024)}KB，超出 uTools 单条数据 1MB 上限，请先精简备注或清空废纸篓`)
  }
  const store = db()
  if (store) store.setItem(key, JSON.parse(text))
  else localStorage.setItem(key, text)
}
