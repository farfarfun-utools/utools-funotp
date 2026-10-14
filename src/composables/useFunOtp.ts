import { computed, getCurrentInstance, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { accountKey, accountLabel, accountMatches, createId, moveItem, normalizeAccount } from '../lib/core'
import type { CodeView, ConfirmOptions, StoredAccount } from '../lib/core'
import { quickFeatureAccountId, quickFeatureCode } from '../lib/features'
import { counterFor, formatCode, generateOtp, remainingSeconds } from '../lib/otp'
import { buildOtpauthUri, parseOtpauthText } from '../lib/otpauth'
import { STORAGE_KEY, groupIdOf, loadState, nextIndex, prepareState } from '../lib/state'
import { readStorage, writeStorage } from '../lib/storage'

// 倒计时圆环由 CSS 动画推进，JS 只需要每秒对一次时间来刷新秒数和验证码。
// 起点对齐到整秒，周期边界一到就能立刻翻新。
const TICK_MS = 1000
const PANEL_HEIGHT = 558

// localeCompare 每次调用都要解析一遍 locale，比较器复用一个就够。
const collator = new Intl.Collator('zh-Hans-CN')

// 旧版 uTools 把方法名拼成了 setExpendHeight，8.0 只认 setExpandHeight
// （文档和 utools-api-types@8.0.0 里都没有老拼写了，运行时是否还留着别名没说）。
// 两个名字都认一遍：只带可选链调一个名字的话，一旦对不上就会把插件压成一条缝。
function setPanelHeight(height: number = PANEL_HEIGHT) {
  const utools = window.utools
  const resize = utools?.setExpandHeight || utools?.setExpendHeight
  resize?.call(utools, height)
}

// 界面没传确认框时退回 window.confirm：单测里不挂组件也要能跑通删除这条路。
function fallbackConfirm(options: ConfirmOptions): Promise<boolean> {
  return Promise.resolve(window.confirm([options.message, options.detail].filter(Boolean).join('\n')))
}

// 整个应用只调一次（App.vue 的 setup）。调第二次会多出一套定时器和一份互相不知道对方存在的
// state，两边都往同一个 dbStorage 键里写，后写的覆盖前写的。
/** 创建 FunOTP 的响应式界面状态及账号、分组和导入导出操作。
 * @param options.confirm 不可撤销操作的确认框，由界面层提供。
 * @returns 供应用界面绑定的状态、计算属性和操作函数。
 */
export function useFunOtp({ confirm = fallbackConfirm }: { confirm?: (options: ConfirmOptions) => Promise<boolean> } = {}) {
  const loaded = loadState({ read: readStorage })
  const state = ref(loaded.state)
  const storageError = ref(loaded.blocked)
  const search = ref('')
  const now = ref(Date.now())
  const toast = reactive({ visible: false, message: '', error: false })
  const codes = reactive({})
  const ringSync = ref(0)
  let toastTimer
  let timer: ReturnType<typeof setInterval> | undefined
  let alignTimer: ReturnType<typeof setTimeout> | undefined
  let viewSaveTimer: ReturnType<typeof setTimeout> | undefined
  let refreshChain = Promise.resolve()
  let queued = false
  let dirty = false
  const pending = new Map()

  const groups = computed(() => state.value.groups)
  const activeGroupId = computed(() => groupIdOf(state.value.currentView))

  // 账号表扫一遍就把界面要的计数全算出来。原来 trashCount、未分组判断、账号总数各扫一遍，
  // 而 groupCount 是按分组逐个扫的，管理分组弹窗打开时就是 O(分组数 × 账号数)。
  const counts = computed(() => {
    const perGroup = new Map<string, number>()
    let active = 0
    let trashed = 0
    let ungrouped = 0
    for (const account of state.value.accounts) {
      if (account.deletedAt) {
        trashed += 1
        continue
      }
      active += 1
      if (!account.groupIds.length) ungrouped += 1
      for (const id of account.groupIds) perGroup.set(id, (perGroup.get(id) || 0) + 1)
    }
    return { active, trashed, ungrouped, perGroup }
  })

  const trashCount = computed(() => counts.value.trashed)
  const activeCount = computed(() => counts.value.active)
  const hasUngrouped = computed(() => counts.value.ungrouped > 0)

  const currentAccounts = computed(() => {
    const active = state.value.accounts.filter(account => !account.deletedAt)
    let accounts
    // 废纸篓要先判断：否则一搜索就跳去搜全部未删除账号，废纸篓里反而搜不到东西。
    if (state.value.currentView === 'trash') accounts = state.value.accounts.filter(account => account.deletedAt)
    else if (search.value.trim() || state.value.currentView === 'all') accounts = active
    else if (state.value.currentView === 'favorites') accounts = active.filter(account => account.favorite)
    else if (state.value.currentView === 'ungrouped') accounts = active.filter(account => !account.groupIds.length)
    else accounts = active.filter(account => account.groupIds.includes(activeGroupId.value))

    const matched = accounts.filter(account => accountMatches(account, search.value, state.value.settings.search))
    const sort = state.value.settings.display.sort
    if (sort === 'manual') return matched
    return matched.slice().sort((a, b) => {
      const left = sort === 'issuer' ? `${a.issuer}${a.name}` : `${a.name}${a.issuer}`
      const right = sort === 'issuer' ? `${b.issuer}${b.name}` : `${b.name}${b.issuer}`
      return collator.compare(left, right)
    })
  })

  // 方向键选中的卡片下标，-1 表示没有显式选中。
  // 搜索词或分组一变，列表内容就整个换了，原来的下标指向的已经不是同一张卡片。
  const activeIndex = ref(-1)
  watch([search, () => state.value.currentView], () => { activeIndex.value = -1 })

  const activeAccount = computed(() => currentAccounts.value[activeIndex.value] || null)

  function moveSelection(delta) {
    activeIndex.value = nextIndex(activeIndex.value, delta, currentAccounts.value.length)
  }

  function selectIndex(index) {
    const total = currentAccounts.value.length
    activeIndex.value = total ? Math.min(Math.max(index, 0), total - 1) : -1
  }

  function clearSelection() {
    activeIndex.value = -1
  }

  // 回车作用在哪张卡片上：优先用方向键显式选中的那张；
  // 没选中时只有开了「回车复制第一个结果」才拿第一张，免得手一抖把不想要的码塞进剪贴板。
  function enterTarget() {
    if (activeAccount.value) return activeAccount.value
    if (!state.value.settings.copy.copyOnEnter) return null
    return currentAccounts.value[0] || null
  }

  // 设置抽屉是直接改 state.settings 的，没人替它调 saveState，所以退出前那次兜底写入不能省；
  // 但「一次都没动过」也整条文档写一遍就是白写（dbStorage 要落盘，还会触发一次云同步）。
  // 用脏标记区分。flush 必须是 sync：默认的异步时机会排在下面的 saveState 之后，
  // 刚清掉的标记又会被这次改动重新立起来。
  watch(state, () => { dirty = true }, { deep: true, flush: 'sync' })

  // 写失败（超出 dbStorage 单文档上限、磁盘异常）必须让用户看见，
  // 否则改动只留在内存里，下次进插件就全没了。
  function saveState() {
    if (storageError.value) return
    try {
      writeStorage(STORAGE_KEY, state.value)
      dirty = false
    } catch (error) {
      showToast(`保存失败：${error.message}`, true)
    }
  }

  // 只给纯界面状态用（当前分组之类）：点一下导航就整条写一次库没必要，丢了也不影响密钥。
  // 账号本身的改动一律立刻落盘，不进这个队列。
  function saveViewSoon() {
    clearTimeout(viewSaveTimer)
    viewSaveTimer = setTimeout(() => {
      viewSaveTimer = undefined
      saveState()
    }, 400)
  }

  // 插件退出时补上没落盘的改动：还没到期的防抖写入，以及设置抽屉那种直接改 state、
  // 等关闭时才保存的路径——用户改完设置就把插件收起来的话，不写这一次就白改了。
  function flushSaves() {
    clearTimeout(viewSaveTimer)
    viewSaveTimer = undefined
    if (dirty) saveState()
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer)
    Object.assign(toast, { visible: true, message, error })
    toastTimer = setTimeout(() => { toast.visible = false }, 2600)
  }

  function counterOf(account) {
    return counterFor(account, now.value)
  }

  // 验证码只在计数器翻页时重算，其余 tick 只是走一下倒计时。
  async function computeCodes(accounts) {
    for (const account of accounts) {
      if (account.deletedAt) continue
      const counter = counterOf(account)
      const signature = signatureOf(account)
      const cached = codes[account.id]
      if (cached && cached.counter === counter && cached.signature === signature) continue
      try {
        const [code, next] = await Promise.all([
          generateOtp({ ...account, counter }),
          generateOtp({ ...account, counter: counter + 1 }),
        ])
        codes[account.id] = { code, next, counter, signature, error: '' }
      } catch (error) {
        codes[account.id] = { code: '', next: '', counter, signature, error: error.message }
      }
    }
  }

  // 排队而不是直接丢弃：之前「正在算就 return」会让 await refreshCodes() 立刻拿到旧码，
  // 从 uTools 关键字复制时就会复制到上一个周期的验证码。
  // 攒成一批而不是只记一个标记，这样「算可见卡片」和「算某个关键字账号」两种请求不会互相挤掉。
  // 最多一轮在算、一轮在排队，定时器高频调用也不会把队列堆起来。
  function queueCodes(accounts) {
    for (const account of accounts) if (!account.deletedAt) pending.set(account.id, account)
    if (!queued) {
      queued = true
      refreshChain = refreshChain.then(() => {
        queued = false
        const batch = [...pending.values()]
        pending.clear()
        return computeCodes(batch)
      })
    }
    return refreshChain
  }

  // 只算真正要显示的那批账号。原来每个 tick 都给所有未删除账号算当前码和下一个码：
  // 100 个账号就是每 30 秒 200 次 WebCrypto 调用，而屏幕上同时只看得见十来张卡片。
  function refreshCodes() {
    return queueCodes(currentAccounts.value)
  }

  // 关键字复制和主搜索推送这两条路径上界面是隐藏的，要用的账号不一定在当前视图里，
  // 用之前得把它们自己的码补上，不能指望 refreshCodes 顺手算到。
  function ensureCodes(accounts) {
    now.value = Date.now()
    return queueCodes(accounts)
  }

  // 切分组或改搜索词时可见的卡片整批换掉，等下一次 tick 才算码会让新卡片先显示一秒「······」。
  watch(currentAccounts, accounts => void queueCodes(accounts))

  // 后台被唤起时定时器是停着的，得先把时间对上再算码。
  function tick() {
    now.value = Date.now()
    return refreshCodes()
  }

  // 改了密钥、位数或算法都要重算，光看计数器会一直用旧值。
  function signatureOf(account) {
    return `${account.secret}|${account.algorithm}|${account.digits}|${account.encoding}`
  }

  function codeOf(account) {
    return codes[account.id] || { code: '', next: '', error: '' }
  }

  function displayCode(account) {
    const entry = codeOf(account)
    if (entry.error) return '密钥错误'
    if (!entry.code) return '······'
    if (state.value.settings.display.maskCode) return '•'.repeat(entry.code.length)
    return formatCode(entry.code, state.value.settings.display.groupDigits)
  }

  function displayNext(account) {
    const entry = codeOf(account)
    return entry.next ? formatCode(entry.next, state.value.settings.display.groupDigits) : ''
  }

  function secondsLeft(account) {
    return account.type === 'hotp' ? 0 : remainingSeconds(now.value, account.period)
  }

  // 验证码长什么样只跟 codes 和显示设置有关，跟每秒跳动的 now 无关。
  // 单独做成 computed 之后，秒数刷新不再让每张卡片把 formatCode（含正则）和打码逻辑重跑一遍，
  // 真正变化的只剩倒计时数字——那本来就是每秒要重画的东西。
  const codeViews = computed(() => {
    const views = new Map<string, CodeView>()
    for (const account of currentAccounts.value) {
      views.set(account.id, {
        code: displayCode(account),
        next: displayNext(account),
        invalid: Boolean(codeOf(account).error),
      })
    }
    return views
  })

  function copyText(text) {
    if (window.utools?.copyText) window.utools.copyText(text)
    else navigator.clipboard?.writeText(text)
  }

  // 三条复制路径（卡片点击、uTools 关键字、主搜索推送）都走这里。
  // 少一处检查就会把空串塞进剪贴板，少一次自增就会让 HOTP 一直复制同一个已失效的码。
  function copyAccountCode(account, { notify = true } = {}) {
    const entry = codeOf(account)
    if (entry.error) {
      if (notify) showToast(`「${accountLabel(account)}」密钥无效`, true)
      return false
    }
    if (!entry.code) {
      if (notify) showToast('验证码还没算出来，请稍等', true)
      return false
    }
    copyText(entry.code)
    // HOTP 用一次就该往前走一格，否则下次还是同一个码。
    if (account.type === 'hotp') {
      account.counter = counterOf(account) + 1
      saveState()
      refreshCodes()
    }
    return true
  }

  function copyCode(account) {
    if (!copyAccountCode(account)) return
    if (state.value.settings.copy.outPlugin && window.utools?.outPlugin) {
      // outPlugin 只退出插件视图，uTools 主搜索框还会弹出来，得先隐藏主窗口才算彻底关掉。
      window.utools?.hideMainWindow?.()
      window.utools.outPlugin()
    } else showToast(`已复制 ${accountLabel(account)} 的验证码`)
  }

  function saveAccount(input) {
    const id = input.id || createId('account')
    const previous = state.value.accounts.find(account => account.id === id)
    const account = normalizeAccount({ ...previous, ...input, id, deletedAt: null })
    if (previous) state.value.accounts[state.value.accounts.indexOf(previous)] = account
    else state.value.accounts.push(account)
    syncQuickFeature(account)
    saveState()
    refreshCodes()
    showToast(previous ? '账号已更新' : '账号已添加')
    return account
  }

  function toggleFavorite(account) {
    account.favorite = !account.favorite
    saveState()
    showToast(account.favorite ? '已加入常用' : '已取消常用')
  }

  function syncQuickFeature(account) {
    if (!window.utools?.setFeature) return
    const code = quickFeatureCode(account.id)
    if (!account.quick || account.deletedAt) return void window.utools.removeFeature?.(code)
    window.utools.setFeature({
      code,
      explain: `复制 ${accountLabel(account)} 的验证码`,
      icon: 'logo.png',
      mainHide: true,
      cmds: [accountLabel(account), account.issuer || account.name].filter(Boolean),
    })
  }

  // 从备份还原、或在插件没运行时清空废纸篓，都会留下指向已不存在账号的动态功能。
  // 这些关键字留在 uTools 里按了只会无声失败，启动时按账号表对一遍账。
  function pruneQuickFeatures() {
    const utools = window.utools
    if (!utools?.getFeatures) return
    const alive = new Set(state.value.accounts
      .filter(account => account.quick && !account.deletedAt)
      .map(account => quickFeatureCode(account.id)))
    for (const feature of utools.getFeatures() || []) {
      const code = feature?.code
      if (quickFeatureAccountId(code) && !alive.has(code)) utools.removeFeature?.(code)
    }
  }

  function toggleQuick(account) {
    account.quick = !account.quick
    syncQuickFeature(account)
    saveState()
    showToast(account.quick ? '已添加到 uTools 关键字' : '已移除 uTools 关键字')
  }

  function moveToTrash(account) {
    account.deletedAt = Date.now()
    account.quick = false
    syncQuickFeature(account)
    saveState()
    showToast('已移到废纸篓，可在废纸篓里恢复')
  }

  function restoreAccount(account) {
    account.deletedAt = null
    saveState()
    refreshCodes()
    showToast('账号已恢复')
  }

  async function deleteAccount(account) {
    const ok = await confirm({
      message: `永久删除「${accountLabel(account)}」？`,
      detail: '密钥一旦删除无法找回，请确认已在该网站关闭两步验证或已有其他备份。',
      confirmText: '永久删除',
      danger: true,
    })
    if (!ok) return
    state.value.accounts = state.value.accounts.filter(item => item.id !== account.id)
    delete codes[account.id]
    window.utools?.removeFeature?.(quickFeatureCode(account.id))
    saveState()
    showToast('账号已永久删除')
  }

  async function emptyTrash() {
    const deleted = state.value.accounts.filter(account => account.deletedAt)
    if (!deleted.length) return showToast('废纸篓已经是空的')
    const ok = await confirm({
      message: `永久删除废纸篓里的 ${deleted.length} 个账号？`,
      detail: '密钥无法找回。',
      confirmText: '清空废纸篓',
      danger: true,
    })
    if (!ok) return
    deleted.forEach(account => delete codes[account.id])
    state.value.accounts = state.value.accounts.filter(account => !account.deletedAt)
    saveState()
    showToast('废纸篓已清空')
  }

  function reorderAccounts(sourceId, targetId) {
    if (state.value.settings.display.sort !== 'manual') return showToast('当前是自动排序，拖动不生效', true)
    state.value.accounts = moveItem(state.value.accounts, sourceId, targetId)
    saveState()
  }

  function setView(view) {
    state.value.currentView = view
    search.value = ''
    saveViewSoon()
  }

  function groupCount(groupId: string) {
    return counts.value.perGroup.get(groupId) || 0
  }

  function addGroup(name) {
    const trimmed = String(name || '').trim()
    if (!trimmed) return
    state.value.groups.push({ id: createId('group'), name: trimmed })
    saveState()
  }

  async function groupAction(id, action, value) {
    const group = state.value.groups.find(item => item.id === id)
    if (!group) return
    if (action === 'rename' && String(value || '').trim()) group.name = String(value).trim()
    if (action === 'delete') {
      // value === true 是调用方已经确认过了的意思（比如从备份恢复时的清理），不再问第二遍。
      const ok = value === true || await confirm({
        message: `删除分组「${group.name}」？`,
        detail: '组内账号会保留，只是不再属于任何分组。',
        confirmText: '删除分组',
        danger: true,
      })
      if (!ok) return
      state.value.groups = state.value.groups.filter(item => item.id !== id)
      state.value.accounts.forEach(account => { account.groupIds = account.groupIds.filter(groupId => groupId !== id) })
      if (activeGroupId.value === id) state.value.currentView = 'all'
    }
    if (action === 'up' || action === 'down') {
      const index = state.value.groups.indexOf(group)
      const target = index + (action === 'up' ? -1 : 1)
      if (target >= 0 && target < state.value.groups.length) {
        state.value.groups[index] = state.value.groups[target]
        state.value.groups[target] = group
      }
    }
    saveState()
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.value.theme
  }

  function cycleTheme() {
    const order = ['system', 'light', 'dark']
    state.value.theme = order[(order.indexOf(state.value.theme) + 1) % order.length]
    saveState()
    applyTheme()
    showToast({ system: '跟随系统主题', light: '已切换浅色主题', dark: '已切换深色主题' }[state.value.theme])
  }

  function saveSettings() {
    saveState()
    refreshCodes()
  }

  // 本地备份和 WebDav 备份必须用同一份内容：各自序列化一遍的话，
  // 将来改备份格式（加字段、加密）一定会漏掉一条路径。
  function backupContent() {
    return JSON.stringify(state.value, null, 2)
  }

  function stamped(prefix: string, extension: string) {
    return `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`
  }

  // 三种结果要分清：桥不存在（浏览器预览）才回落到 <a download>；
  // 桥返回 false 是用户在保存框里点了取消，这时既不提示成功、也不能偷偷下载一份到下载目录。
  function saveToFile(content: string, name: string, type: string) {
    const bridge = window.funotp?.saveBackup
    if (!bridge) {
      downloadFile(content, name, type)
      return true
    }
    return bridge(content, name)
  }

  function exportFile(content: string, name: string, type: string, success: string, failure: string) {
    try {
      if (saveToFile(content, name, type)) showToast(success)
    } catch (error) {
      showToast(`${failure}：${error.message}`, true)
    }
  }

  function exportBackup() {
    exportFile(backupContent(), stamped('funotp', 'json'), 'application/json', '备份已导出，请妥善保管', '备份导出失败')
  }

  async function exportUris() {
    const ok = await confirm({
      message: '导出明文密钥文件？',
      detail: '文件里是明文密钥，任何拿到它的人都能生成你的验证码。',
      confirmText: '确认导出',
      danger: true,
    })
    if (!ok) return
    const content = state.value.accounts.filter(account => !account.deletedAt).map(buildOtpauthUri).join('\n')
    exportFile(content, stamped('funotp-uris', 'txt'), 'text/plain', '密钥已导出，请妥善保管', '密钥导出失败')
  }

  function downloadFile(content: string, name: string, type: string) {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([content], { type }))
    link.download = name
    link.click()
    // 同一个任务里 revoke 会让 Chromium 有机会在下载真正开始前就把 blob 收走，下一帧再放。
    setTimeout(() => URL.revokeObjectURL(link.href), 0)
  }

  // 导入永远是「追加 + 去重」：两步验证密钥丢一条就可能锁死一个账号，不做覆盖式导入。
  function importAccounts(list, groupId = '') {
    const existing = new Set(state.value.accounts.map(accountKey))
    const added: StoredAccount[] = []
    for (const item of list) {
      const account = normalizeAccount({ ...item, id: createId('account'), groupIds: groupId ? [groupId] : [] })
      if (existing.has(accountKey(account))) continue
      existing.add(accountKey(account))
      state.value.accounts.push(account)
      added.push(account)
    }
    saveState()
    refreshCodes()
    return added
  }

  async function processDataFile(type, content, options: { groupId?: string } = {}) {
    try {
      if (type === 'restore') {
        const { state: restored, dropped } = prepareState(JSON.parse(content))
        // 恢复是整表替换，不是合并：备份之后新加的账号会消失，而且没有撤销。
        // 导入（otpauth 链接那条路）才是追加 + 去重，不用问。
        const incoming = restored.accounts.filter(account => !account.deletedAt).length
        const ok = await confirm({
          message: '用备份覆盖当前数据？',
          detail: `当前 ${activeCount.value} 个账号会被备份里的 ${incoming} 个替换，覆盖后无法撤销。`,
          confirmText: '覆盖恢复',
          danger: true,
        })
        if (!ok) return false
        state.value = restored
        // 恢复成功即说明拿到了可用数据，可以解除只读保护。
        storageError.value = ''
        saveState()
        applyTheme()
        refreshCodes()
        // 账号表整体换掉了：重新注册备份里标了关键字的账号，并清掉指向旧账号的残留。
        state.value.accounts.forEach(syncQuickFeature)
        pruneQuickFeatures()
        showToast(dropped ? `备份已恢复，跳过 ${dropped} 条无效账号` : '备份已恢复')
        return true
      }
      const { accounts, errors } = parseOtpauthText(content)
      if (!accounts.length) throw new Error(errors[0] || '没有找到 otpauth:// 链接')
      const added = importAccounts(accounts, options.groupId)
      const skipped = accounts.length - added.length
      showToast(`已导入 ${added.length} 个账号${skipped ? `，跳过 ${skipped} 个重复` : ''}${errors.length ? `，${errors.length} 条无法识别` : ''}`)
      return true
    } catch (error) {
      showToast(error.message, true)
      return false
    }
  }

  function setupUtools({ addAccount }) {
    setPanelHeight()
    window.utools?.setSubInput?.(({ text }) => { search.value = text || '' }, '搜索账号', true)
    state.value.accounts.forEach(syncQuickFeature)
    pruneQuickFeatures()

    // outPlugin 不传 isKill 时插件只是隐藏到后台、进程还在跑，定时器不停就是白烧 CPU。
    window.utools?.onPluginOut?.(() => stopTicking())

    window.funotp?.onEnter(async action => {
      setPanelHeight()
      startTicking()
      const quickId = quickFeatureAccountId(action.code)
      if (quickId) {
        const account = state.value.accounts.find(item => item.id === quickId)
        if (!account) return
        // 关键字指向的账号不一定在当前视图里，refreshCodes 只算可见卡片，这里得点名算它。
        await ensureCodes([account])
        // 这条路径上界面是隐藏的，复制失败就把窗口拉回来让用户看到提示，而不是静默退出。
        if (!copyAccountCode(account)) return void window.utools?.showMainWindow?.()
        window.utools?.hideMainWindow?.()
        window.utools?.outPlugin?.()
        return
      }
      if (action.code === 'add-otp') {
        const { accounts } = parseOtpauthText(String(action.payload || ''))
        if (accounts.length === 1) addAccount(accounts[0])
        else if (accounts.length > 1) showToast(`已导入 ${importAccounts(accounts).length} 个账号`)
        return
      }
      if (action.code === 'search-otp') {
        const keyword = String(action.payload || '')
        search.value = keyword
        // 卡片已经按关键字过滤了，子输入框却还是空的：用户再敲一个字，onChange 回来的
        // 就只有那一个字，整个关键字被悄悄换掉。把关键字回填进去，接着改才是接着改。
        window.utools?.setSubInputValue?.(keyword)
        // 关键字是在主搜索框里打完才进来的，接下来要做的是「挑一个按回车」，不是接着打字。
        // 子输入框属于主窗口，焦点留在它上面的话方向键和回车根本到不了插件页面。
        // 这里把焦点交出去，键盘操作立刻能用；想改关键字点一下输入框就行。
        window.utools?.subInputBlur?.()
      }
    })

    window.utools?.onMainPush?.(({ payload }) => {
      const matched = state.value.accounts
        .filter(account => !account.deletedAt && accountMatches(account, payload, state.value.settings.search))
        .slice(0, 8)
      // 插件刚被后台唤起时定时器是停着的，这里补一次对时，并点名算这几条——它们不在当前视图里，
      // 指望不上只算可见卡片的 refreshCodes。下一次按键就能显示出来。
      ensureCodes(matched)
      return matched.map(account => ({
        icon: 'logo.png',
        text: formatCode(codeOf(account).code, true) || '计算中…',
        title: accountLabel(account),
        accountId: account.id,
      }))
    },
    // onSelect 必须同步返回 boolean：写成 async 返回的是 Promise，uTools 判断不出该不该进插件，
    // 而且复制会发生在回调返回之后。返回 false = 复制完留在主搜索框，不进插件界面。
    ({ option }) => {
      const account = state.value.accounts.find(item => item.id === option?.accountId)
      if (!account) return false
      if (!copyAccountCode(account)) return true
      window.utools?.hideMainWindow?.()
      return false
    })
  }

  function startTicking() {
    if (timer || alignTimer) return
    tick()
    // 圆环要按当前时钟重新对齐：插件可能在后台停了很久，机器也可能睡过一觉。
    ringSync.value += 1
    alignTimer = setTimeout(() => {
      alignTimer = undefined
      tick()
      timer = setInterval(tick, TICK_MS)
    }, TICK_MS - Date.now() % TICK_MS)
  }

  function stopTicking() {
    clearTimeout(alignTimer)
    clearInterval(timer)
    alignTimer = undefined
    timer = undefined
    flushSaves()
  }

  // 不在组件里调用时（单测）Vue 只会警告一句然后什么都不做，自己判断一下省掉这行噪音。
  if (getCurrentInstance()) onBeforeUnmount(stopTicking)

  applyTheme()
  startTicking()

  return {
    state, search, now, toast, storageError, codes, groups, activeGroupId, currentAccounts, ringSync,
    trashCount, activeCount, hasUngrouped, codeViews,
    activeAccount, moveSelection, selectIndex, clearSelection, enterTarget,
    codeOf, displayCode, displayNext, secondsLeft, copyCode, copyText,
    saveAccount, toggleFavorite, toggleQuick, moveToTrash, restoreAccount, deleteAccount, emptyTrash,
    reorderAccounts, setView, groupCount, addGroup, groupAction, cycleTheme, saveSettings,
    exportBackup, exportUris, backupContent, importAccounts, processDataFile, setupUtools, showToast, refreshCodes,
    confirm,
  }
}
