import assert from 'node:assert/strict'
import { test } from 'vitest'
import { accountKey, accountLabel, initials, migrateState, moveItem, normalizeAccount, validateState } from '../src/lib/core'
import { DEFAULT_SETTINGS, STORAGE_KEY, emptyState, hydrateState, loadState, nextIndex, prepareState } from '../src/lib/state'

const SECRET = 'JBSWY3DPEHPK3PXP'

function savedState(overrides = {}) {
  return {
    version: 1,
    theme: 'dark',
    currentView: 'all',
    settings: {},
    groups: [{ id: 'g1', name: '工作' }],
    accounts: [{ id: 'a1', secret: SECRET, issuer: 'GitHub', name: 'me', groupIds: ['g1'] }],
    ...overrides,
  }
}

test('normalizeAccount 补齐默认值并夹住越界参数', () => {
  const account = normalizeAccount({ secret: ' jbswy3dp ehpk3pxp ', issuer: 'GitHub', digits: 99, period: -5 })
  assert.equal(account.secret, SECRET)
  assert.equal(account.type, 'totp')
  assert.equal(account.algorithm, 'SHA1')
  assert.equal(account.digits, 10)
  assert.equal(account.period, 30)
  assert.equal(account.icon, 'GI')
  assert.match(String(account.color), /^#[\da-f]{6}$/i)
  assert.deepEqual(account.groupIds, [])
})

test('HOTP 才保留计数器，TOTP 一律归零', () => {
  assert.equal(normalizeAccount({ secret: SECRET, type: 'hotp', counter: 5 }).counter, 5)
  assert.equal(normalizeAccount({ secret: SECRET, type: 'totp', counter: 5 }).counter, 0)
  assert.equal(normalizeAccount({ secret: SECRET, type: 'hotp', counter: -3 }).counter, 0)
})

test('同一个服务商每次得到同一种颜色', () => {
  assert.equal(normalizeAccount({ secret: SECRET, issuer: 'GitHub' }).color, normalizeAccount({ secret: SECRET, issuer: 'GitHub' }).color)
})

test('initials 支持中英文', () => {
  assert.equal(initials('GitHub'), 'GI')
  assert.equal(initials('Google Cloud'), 'GC')
  assert.equal(initials('阿里云盘'), '阿里')
  assert.equal(initials(''), 'OTP')
})

test('accountLabel 拼接服务商与账号名', () => {
  assert.equal(accountLabel({ issuer: 'GitHub', name: 'me' }), 'GitHub · me')
  assert.equal(accountLabel({ issuer: 'openai', name: '' }), 'openai')
  assert.equal(accountLabel({ issuer: '', name: '' }), '未命名')
})

test('accountKey 用于导入去重，忽略大小写与空格', () => {
  const left = accountKey({ secret: ' jbswy3dp-ehpk3pxp ', issuer: 'GitHub', name: 'Me' })
  const right = accountKey({ secret: SECRET, issuer: 'github', name: 'me' })
  assert.equal(left, right)
})

test('migrateState 丢掉密钥无效的账号，并清理指向已删分组的引用', () => {
  const { state, dropped } = migrateState(savedState({
    accounts: [
      { id: 'a1', secret: SECRET, issuer: 'GitHub', groupIds: ['g1', '已经没了'] },
      { id: 'a2', secret: '不是-base32-!!', issuer: '坏数据' },
      { id: 'a3', secret: '', issuer: '空密钥' },
    ],
  }))
  assert.equal(dropped, 2)
  assert.equal(state.accounts.length, 1)
  assert.deepEqual(state.accounts[0].groupIds, ['g1'])
})

test('validateState 只接受本插件的备份格式', () => {
  assert.throws(() => validateState({ version: 1, bookmarks: [] }), /不是有效的 FunOTP 备份/)
  assert.throws(() => validateState(null), /不是有效的 FunOTP 备份/)
  assert.doesNotThrow(() => validateState(savedState()))
})

test('hydrateState 合并默认设置，且不丢用户已改的值', () => {
  const state = hydrateState(savedState({ settings: { display: { columns: 2 } } }))
  assert.equal(state.settings.display.columns, 2)
  assert.equal(state.settings.display.groupDigits, DEFAULT_SETTINGS.display.groupDigits)
  assert.deepEqual(state.settings.search, DEFAULT_SETTINGS.search)
})

test('停留在已删除分组时回落到「全部」', () => {
  const state = hydrateState(savedState({ currentView: 'group:不存在' }))
  assert.equal(state.currentView, 'all')
})

test('loadState 在读不出数据时不写空数据，而是标记为只读', () => {
  const blocked = loadState({ read: () => { throw new Error('数据库锁住了') } })
  assert.match(blocked.blocked, /数据库锁住了/)
  assert.deepEqual(blocked.state.accounts, [])

  const broken = loadState({ read: () => ({ version: 99 }) })
  assert.match(broken.blocked, /无法解析/)

  const missing = loadState({ read: () => null })
  assert.equal(missing.blocked, '')
  assert.deepEqual(missing.state, emptyState())

  const fine = loadState({ read: key => (key === STORAGE_KEY ? savedState() : null) })
  assert.equal(fine.blocked, '')
  assert.equal(fine.state.accounts.length, 1)
  assert.equal(fine.state.theme, 'dark')
})

test('prepareState 是恢复备份的完整入口', () => {
  const { state } = prepareState(savedState())
  assert.equal(state.accounts[0].secret, SECRET)
  assert.equal(state.settings.copy.outPlugin, DEFAULT_SETTINGS.copy.outPlugin)
})

test('moveItem 按目标位置重排', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(moveItem(items, 'c', 'a').map(item => item.id), ['c', 'a', 'b'])
  assert.deepEqual(moveItem(items, 'a', 'a').map(item => item.id), ['a', 'b', 'c'])
  assert.deepEqual(moveItem(items, 'a', '不存在').map(item => item.id), ['a', 'b', 'c'])
})

test('nextIndex 在列表范围内夹住方向键移动', () => {
  // 还没选中：往后走从第一张开始，往前走从最后一张开始。
  assert.equal(nextIndex(-1, 1, 5), 0)
  assert.equal(nextIndex(-1, 3, 5), 0, '上下键跨行时也要从第一张开始，不是跳到第 3 张')
  assert.equal(nextIndex(-1, -1, 5), 4)

  assert.equal(nextIndex(0, 1, 5), 1)
  assert.equal(nextIndex(2, 3, 5), 4, '最后一行不满时停在末尾而不是越界')
  assert.equal(nextIndex(4, 1, 5), 4, '到底了就不动')
  assert.equal(nextIndex(0, -1, 5), 0, '到头了就不动')
  assert.equal(nextIndex(1, -3, 5), 0)

  assert.equal(nextIndex(3, 1, 0), -1, '列表空了就取消选中')
  assert.equal(nextIndex(-1, 1, 0), -1)
})
