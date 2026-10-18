import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { nextTick } from 'vue'
import { useFunOtp } from '../src/composables/useFunOtp'
import { quickFeatureCode } from '../src/lib/features'
import { STORAGE_KEY, groupView } from '../src/lib/state'

// composable 里有定时器、剪贴板和文件桥，这些都要自己搭。
// 换来的是能覆盖「复制」「导出」「删除」这几条最怕静默出错的路径——
// 它们各自都有过真实的 bug（导出取消后偷偷下载、HOTP 不自增、关键字账号算不出码）。
const SECRET = 'JBSWY3DPEHPK3PXP'

function account(id: string, extra: Record<string, unknown> = {}) {
  return { id, secret: SECRET, type: 'totp', name: id, issuer: '', digits: 6, period: 30, groupIds: [], ...extra }
}

function storedState(accounts: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { version: 1, theme: 'system', currentView: 'all', groups: [], accounts, ...extra }
}

function fakeDb(initial: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    writes: 0,
    getItem(key: string) { return map.has(key) ? map.get(key) : null },
    setItem(key: string, value: unknown) { this.writes += 1; map.set(key, value) },
    removeItem(key: string) { map.delete(key) },
  }
}

// 落盘的那份是 dbStorage 里的裸对象，没有类型；断言前统一拆一次。
function savedAccounts(db: { getItem: (key: string) => unknown }) {
  return (db.getItem(STORAGE_KEY) as { accounts: Record<string, unknown>[] }).accounts
}

interface Harness {
  stored?: Record<string, unknown>
  utools?: Record<string, unknown>
  funotp?: Record<string, unknown>
}

function setup({ stored, utools, funotp }: Harness = {}) {
  const db = fakeDb(stored ? { [STORAGE_KEY]: stored } : {})
  const copied: string[] = []
  const api = {
    dbStorage: db,
    copyText: (text: string) => {
      copied.push(text)
      return true
    },
    ...utools,
  }
  vi.stubGlobal('window', { utools: api, funotp })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  return { db, copied, api }
}

// 算码要等 WebCrypto，它在 Node 里是走线程池的，只刷微任务队列等不到。
// 盲等几轮事件循环会偶发失败（机器一忙就拿到空码），所以直接等 composable 自己那条算码链：
// refreshCodes() 返回的 promise 落地时，这一批码一定已经写进 codes 了。
async function settle(otp?: { refreshCodes: () => Promise<void> }) {
  await nextTick()
  if (otp) await otp.refreshCodes()
  await nextTick()
}

// 只接管定时器：composable 一创建就起了 1 秒心跳，真跑起来会在别的测试里乱翻验证码。
// setImmediate 和 Date 得留着真的，否则 settle 等不到 WebCrypto。
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] }))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('只给当前视图里的账号算验证码', async () => {
  const stored = storedState(
    [account('a', { groupIds: ['g1'] }), account('b'), account('c', { deletedAt: Date.now() })],
    { groups: [{ id: 'g1', name: '工作' }], currentView: groupView('g1') },
  )
  setup({ stored })
  const otp = useFunOtp()
  await settle(otp)

  assert.deepEqual(otp.currentAccounts.value.map(item => item.id), ['a'])
  assert.match(otp.codeOf(otp.state.value.accounts[0]).code, /^\d{6}$/)
  assert.equal(otp.codeOf(otp.state.value.accounts[1]).code, '', '不在当前视图里的账号不该白算')
  assert.equal((otp.codes as Record<string, unknown>).c, undefined, '废纸篓里的账号永远不算')

  // 切到「全部」之后，新出现的卡片不该等下一次 tick 才有码。
  otp.setView('all')
  await settle(otp)
  assert.match(otp.codeOf(otp.state.value.accounts[1]).code, /^\d{6}$/)
})

test('HOTP 复制后计数器自增并落盘', async () => {
  const { db, copied } = setup({ stored: storedState([account('h', { type: 'hotp', counter: 3 })]) })
  const otp = useFunOtp()
  await settle(otp)

  const hotp = otp.state.value.accounts[0]
  const before = otp.codeOf(hotp).code
  assert.match(before, /^\d{6}$/)

  otp.copyCode(hotp)
  await settle(otp)
  assert.deepEqual(copied, [before])
  assert.equal(hotp.counter, 4, '不自增的话下次还是同一个码')
  assert.equal(savedAccounts(db)[0].counter, 4)
  assert.notEqual(otp.codeOf(hotp).code, before)
})

test('密钥无效时不往剪贴板塞东西', async () => {
  const { copied } = setup({ stored: storedState([]) })
  const otp = useFunOtp()
  await settle(otp)

  // 备份里的坏密钥在 migrateState 就被丢掉了，手填这条路没有那道筛子。
  const broken = otp.saveAccount({ name: '手填', secret: '1' })
  await settle(otp)
  assert.ok(otp.codeOf(broken).error, '非法 base32 应该留下错误')
  otp.copyCode(broken)
  assert.deepEqual(copied, [])
  assert.equal(otp.toast.error, true)
})

test('保存框点取消时既不提示成功也不落文件', async () => {
  const saved: string[] = []
  setup({
    stored: storedState([account('a')]),
    funotp: {
      saveBackup: (content: string) => {
        saved.push(content)
        return false
      },
    },
  })
  const otp = useFunOtp()
  await settle(otp)

  otp.exportBackup()
  assert.equal(saved.length, 1, '内容还是生成了，只是用户没要')
  assert.equal(otp.toast.visible, false, '取消不该提示「已导出」')

  // 桥抛错（磁盘满、没权限）要把原因显示出来，而不是静默失败。
  setup({ stored: storedState([account('a')]), funotp: { saveBackup: () => { throw new Error('磁盘空间不足') } } })
  const broken = useFunOtp()
  await settle(broken)
  broken.exportBackup()
  assert.equal(broken.toast.error, true)
  assert.match(broken.toast.message, /磁盘空间不足/)
})

test('导出明文密钥要先确认', async () => {
  const saved: string[] = []
  const bridge = {
    saveBackup: (content: string) => {
      saved.push(content)
      return true
    },
  }
  setup({ stored: storedState([account('a'), account('b', { deletedAt: Date.now() })]), funotp: bridge })

  const declined = useFunOtp({ confirm: () => Promise.resolve(false) })
  await settle(declined)
  await declined.exportUris()
  assert.equal(saved.length, 0, '点取消就不该把明文密钥写出去')

  const accepted = useFunOtp({ confirm: () => Promise.resolve(true) })
  await settle(accepted)
  await accepted.exportUris()
  assert.equal(saved.length, 1)
  assert.match(saved[0], /^otpauth:\/\/totp\//)
  assert.equal(saved[0].split('\n').length, 1, '废纸篓里的账号不导出')
})

test('删除账号要确认，并且清掉验证码缓存和 uTools 关键字', async () => {
  const removed: string[] = []
  setup({
    stored: storedState([account('a', { quick: true })]),
    utools: { removeFeature: (code: string) => void removed.push(code), getFeatures: () => [] },
  })

  const otp = useFunOtp({ confirm: () => Promise.resolve(false) })
  await settle(otp)
  await otp.deleteAccount(otp.state.value.accounts[0])
  assert.equal(otp.state.value.accounts.length, 1, '点了取消就什么都别做')

  const sure = useFunOtp({ confirm: () => Promise.resolve(true) })
  await settle(sure)
  const target = sure.state.value.accounts[0]
  await sure.deleteAccount(target)
  assert.equal(sure.state.value.accounts.length, 0)
  assert.equal(sure.codes[target.id], undefined, '留着缓存会让同 id 的新账号读到旧码')
  assert.deepEqual(removed, [quickFeatureCode('a')])
})

test('从备份恢复会先问一句，确认后才整表替换', async () => {
  setup({ stored: storedState([account('local')]) })
  const backup = JSON.stringify(storedState([account('remote')]))

  const otp = useFunOtp({ confirm: () => Promise.resolve(false) })
  await settle(otp)
  assert.equal(await otp.processDataFile('restore', backup), false)
  assert.deepEqual(otp.state.value.accounts.map(item => item.id), ['local'])

  const sure = useFunOtp({ confirm: () => Promise.resolve(true) })
  await settle(sure)
  assert.equal(await sure.processDataFile('restore', backup), true)
  assert.equal(sure.state.value.accounts.length, 1)
  assert.equal(sure.state.value.accounts[0].name, 'remote')
})

test('恢复写入失败时保留原账号且不报告成功', async () => {
  const { db } = setup({ stored: storedState([account('local')]) })
  const otp = useFunOtp({ confirm: () => Promise.resolve(true) })
  await settle(otp)
  db.setItem = () => { throw new Error('disk full') }

  assert.equal(await otp.processDataFile('restore', JSON.stringify(storedState([account('remote')]))), false)
  assert.deepEqual(otp.state.value.accounts.map(item => item.id), ['local'])
  assert.deepEqual(savedAccounts(db).map(item => item.id), ['local'])
  assert.equal(otp.toast.error, true)
})

test('导入是追加去重，不碰已有账号', async () => {
  setup({ stored: storedState([account('a')]) })
  const otp = useFunOtp()
  await settle(otp)

  const uri = `otpauth://totp/Acme:me?secret=${SECRET}`
  assert.equal(await otp.processDataFile('import', `${uri}\n${uri}`), true)
  assert.equal(otp.state.value.accounts.length, 2, '两条一样的链接只进一条')
  assert.equal(otp.state.value.accounts[0].id, 'a', '原有账号不动')
})

test('计数一次扫表就全算出来', async () => {
  setup({
    stored: storedState(
      [
        account('a', { groupIds: ['g1'] }),
        account('b', { groupIds: ['g1', 'g2'] }),
        account('c'),
        account('d', { deletedAt: Date.now(), groupIds: ['g1'] }),
      ],
      { groups: [{ id: 'g1', name: '工作' }, { id: 'g2', name: '个人' }] },
    ),
  })
  const otp = useFunOtp()
  await settle(otp)

  assert.equal(otp.activeCount.value, 3)
  assert.equal(otp.trashCount.value, 1)
  assert.equal(otp.hasUngrouped.value, true)
  assert.equal(otp.groupCount('g1'), 2, '废纸篓里的账号不计入分组')
  assert.equal(otp.groupCount('g2'), 1)
  assert.equal(otp.groupCount('none'), 0)
})

test('废纸篓里也能搜索', async () => {
  setup({
    stored: storedState(
      [account('github', { deletedAt: Date.now() }), account('gitlab', { deletedAt: Date.now() }), account('alive')],
      { currentView: 'trash' },
    ),
  })
  const otp = useFunOtp()
  await settle(otp)

  assert.equal(otp.currentAccounts.value.length, 2)
  otp.search.value = 'github'
  await nextTick()
  assert.deepEqual(otp.currentAccounts.value.map(item => item.id), ['github'], '搜索不该把视图切回未删除账号')
})

test('什么都没改时退出不重复写一遍库', async () => {
  const { db } = setup({ stored: storedState([account('a')]) })
  const otp = useFunOtp()
  await settle(otp)
  assert.equal(db.writes, 0, '只是打开插件不该产生写入')

  otp.toggleFavorite(otp.state.value.accounts[0])
  await settle()
  assert.equal(db.writes, 1)

  // onPluginOut 会走到 stopTicking → flushSaves，这时已经没有未落盘的改动了。
  otp.setView('all')
  await settle()
  assert.equal(db.writes, 1, '视图没变就不写')
})

test('读不出本地数据时暂停一切写入', async () => {
  const db = fakeDb()
  db.getItem = () => { throw new Error('数据库损坏') }
  vi.stubGlobal('window', { utools: { dbStorage: db } })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })

  const otp = useFunOtp()
  await settle(otp)
  assert.match(otp.storageError.value, /数据库损坏/)

  otp.addGroup('工作')
  await settle()
  assert.equal(db.writes, 0, '只读保护期间写一次就会把用户的真实密钥覆盖成空表')
})
