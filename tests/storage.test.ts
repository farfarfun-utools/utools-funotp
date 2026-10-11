import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import { readStorage, writeStorage } from '../src/lib/storage'

// storage.ts 直接用全局的 window 和 localStorage，node 环境里要自己搭一套。
function fakeLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
  }
}

function fakeDbStorage(initial: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: unknown) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

let local: ReturnType<typeof fakeLocalStorage>

beforeEach(() => {
  local = fakeLocalStorage()
  Object.assign(globalThis, { window: {}, localStorage: local })
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).localStorage
})

test('没有 uTools 时读写都落在 localStorage 上', () => {
  writeStorage('k', { a: 1 })
  assert.equal(local.map.get('k'), '{"a":1}')
  assert.deepEqual(readStorage('k'), { a: 1 })
})

test('读不到时返回 fallback，坏 JSON 也不抛错', () => {
  assert.equal(readStorage('missing'), null)
  assert.deepEqual(readStorage('missing', { d: true }), { d: true })
  local.map.set('broken', '{oops')
  assert.deepEqual(readStorage('broken', 'fallback'), 'fallback')
})

test('有 uTools 时写进 dbStorage，不再碰 localStorage', () => {
  const dbStorage = fakeDbStorage()
  Object.assign(globalThis, { window: { utools: { dbStorage } } })
  writeStorage('k', { a: 1 })
  assert.deepEqual(dbStorage.map.get('k'), { a: 1 })
  assert.equal(local.map.has('k'), false)
})

test('老版本留在 localStorage 的数据会被迁进 dbStorage 并清掉旧的', () => {
  local.map.set('funotp-state-v1', '{"version":1}')
  const dbStorage = fakeDbStorage()
  Object.assign(globalThis, { window: { utools: { dbStorage } } })

  assert.deepEqual(readStorage('funotp-state-v1'), { version: 1 })
  assert.deepEqual(dbStorage.map.get('funotp-state-v1'), { version: 1 })
  assert.equal(local.map.has('funotp-state-v1'), false, '迁移后不能在 localStorage 里留副本')
})

test('dbStorage 里已有数据时不会被 localStorage 的旧副本盖掉', () => {
  local.map.set('k', '{"from":"local"}')
  const dbStorage = fakeDbStorage({ k: { from: 'db' } })
  Object.assign(globalThis, { window: { utools: { dbStorage } } })
  assert.deepEqual(readStorage('k'), { from: 'db' })
})

test('写入体积超过 uTools 的 1MB 文档上限时提前报错，而不是让 setItem 炸掉', () => {
  const dbStorage = fakeDbStorage()
  Object.assign(globalThis, { window: { utools: { dbStorage } } })
  assert.throws(() => writeStorage('k', { note: 'x'.repeat(1024 * 1024) }), /1MB/)
  assert.equal(dbStorage.map.has('k'), false, '超限时不能写进半条数据')
})

test('响应式代理会被序列化摊平，dbStorage 拿到的是纯数据', () => {
  const dbStorage = fakeDbStorage()
  Object.assign(globalThis, { window: { utools: { dbStorage } } })
  const proxy = new Proxy({ a: 1 }, { get: (target, key) => target[key] })
  writeStorage('k', proxy)
  const stored = dbStorage.map.get('k')
  assert.equal(Object.getPrototypeOf(stored), Object.prototype)
  assert.deepEqual(stored, { a: 1 })
})

test('循环引用这类无法序列化的数据直接抛错，不会写进半条数据', () => {
  const dbStorage = fakeDbStorage()
  Object.assign(globalThis, { window: { utools: { dbStorage } } })
  const circular: { self?: unknown } = {}
  circular.self = circular
  assert.throws(() => writeStorage('k', circular))
  assert.equal(dbStorage.map.has('k'), false)
})
