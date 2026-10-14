import { isValidSecret, normalizeSecret } from './base32'
import { DEFAULT_DIGITS, DEFAULT_PERIOD, normalizeDigits, normalizePeriod } from './otp'

export const COLORS = ['#16b8c7', '#2563eb', '#7c3aed', '#db2777', '#e85d3f', '#0f9f6e', '#f59e0b', '#64748b']

// 可参与搜索的字段。DEFAULT_SETTINGS.search 也用这一份，免得两边各写一遍再慢慢漂移。
export const SEARCH_FIELDS = ['name', 'issuer', 'note'] as const

// 不留 [key: string]: unknown 的索引签名：有它的话 account.secrt 这种拼错也能编过，
// 读出 undefined 之后一路静默走到「算不出验证码」。
export interface Account {
  id?: string
  secret?: string
  type?: string
  issuer?: string
  name?: string
  algorithm?: string
  digits?: number
  period?: number
  counter?: number
  encoding?: string
  groupIds?: string[]
  color?: string
  icon?: string
  favorite?: boolean
  quick?: boolean
  note?: string
  deletedAt?: unknown
}

// Account 描述的是手填、扫码、导入这些还没落库的半成品；
// 存进状态的账号都过了 normalizeAccount 和 migrateState 的筛，id 和密钥必然齐全，算码和拖动排序才敢直接用。
export interface StoredAccount extends Account {
  id: string
  secret: string
  groupIds: string[]
}

export interface Group { id: string, name: string }

// 备份文件的形状。theme / currentView / settings 是上一次运行时顺手存进去的界面状态，
// 老备份里可能没有，由 hydrateState 补齐，所以这里声明成可选的未知值。
export interface BackupState {
  version: number
  groups: Group[]
  accounts: Account[]
  theme?: unknown
  currentView?: unknown
  settings?: unknown
}

// 卡片上验证码的展示形态：已经打码 / 分组 / 换成错误文案之后的样子。
// 由 composable 统一算好，卡片只负责画出来——否则每秒的倒计时刷新都会把格式化重跑一遍。
export interface CodeView { code: string, next: string, invalid: boolean }

// 确认框的文案。放在这里是因为提问的是 composable、画出来的是组件，两边都要认这个形状。
export interface ConfirmOptions {
  message: string
  /** 第二行小字，用来写清楚后果（密钥删了找不回之类）。 */
  detail?: string
  confirmText?: string
  /** 确定按钮标红，用在不可撤销的操作上。 */
  danger?: boolean
}

// 同一个服务商每次都落到同一种颜色，卡片墙看起来才稳定。
/** 根据稳定的文本种子选择预设颜色。
 * @param seed 用于计算颜色的文本。
 * @returns CSS 颜色值。
 */
export function colorFor(seed: unknown): string {
  const text = String(seed || '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  return COLORS[hash % COLORS.length]
}

/** 校验颜色字符串并在无效时返回默认颜色。
 * @param value 待校验的颜色。
 * @returns 可安全用于样式的颜色值。
 */
export function safeColor(value: unknown): string {
  const color = String(value || '')
  return /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color) ? color : COLORS[0]
}

/** 从名称生成最多两个字符的头像文本。
 * @param value 服务商或账号名称。
 * @returns 头像文本。
 */
export function initials(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return 'OTP'
  // 中文按前两个字取，拉丁文取每个单词首字母。
  if (/^[一-龥]/.test(text)) return text.slice(0, 2)
  const words = text.split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words.map(word => word[0]).join('') : words[0] || text).slice(0, 2).toUpperCase()
}

/** 生成用于界面展示的账号名称。
 * @param account 账号数据。
 * @returns 服务商与账号名组成的标签。
 */
export function accountLabel(account: Account): string {
  return [account.issuer, account.name].map(part => String(part || '').trim()).filter(Boolean).join(' · ') || '未命名'
}

/** 判断账号的指定字段是否包含关键字。
 * @param account 待搜索的账号。
 * @param keyword 搜索关键字。
 * @param fields 参与搜索的字段名。
 * @returns 匹配时为 `true`。
 */
export function accountMatches(account: Account, keyword: unknown, fields: readonly string[] = SEARCH_FIELDS): boolean {
  const query = String(keyword || '').trim().toLocaleLowerCase()
  if (!query) return true
  // some 而不是 map().filter().some()：命中第一个字段就不用再把其余字段都转成小写。
  return fields.some(field => {
    const value = account[field as keyof Account]
    return Boolean(value) && String(value).toLocaleLowerCase().includes(query)
  })
}

/** 去除无效和重复的分组标识。
 * @param groupIds 待规范化的分组标识。
 * @returns 唯一的非空分组标识。
 */
export function normalizeGroupIds(groupIds: unknown): string[] {
  const ids = Array.isArray(groupIds) ? groupIds.filter(id => typeof id === 'string' && id) : []
  return [...new Set(ids)]
}

let idCounter = 0

/** 生成带前缀的本地唯一标识。
 * @param prefix 标识前缀。
 * @returns 新生成的标识。
 */
export function createId(prefix: string = 'id'): string {
  idCounter += 1
  const unique = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${unique}`
}

// 把任意来源（手填、扫码、导入、备份）的账号补成完整、可直接算码的形状。
/** 将任意来源的账号数据补全为可使用的形状。
 * @param input 待规范化的账号数据。
 * @returns 规范化后的账号，密钥一定是字符串，入参带上 id 时结果也带 id。
 */
export function normalizeAccount<T extends Account>(input: T): T & Account & { secret: string, groupIds: string[] } {
  const account: Account = { ...input }
  account.secret = normalizeSecret(account.secret)
  account.type = account.type === 'hotp' ? 'hotp' : 'totp'
  account.issuer = String(account.issuer || '').trim()
  account.name = String(account.name || '').trim()
  account.algorithm = ['SHA1', 'SHA256', 'SHA512'].includes(account.algorithm || '') ? account.algorithm : 'SHA1'
  account.digits = normalizeDigits(account.digits ?? DEFAULT_DIGITS)
  account.period = normalizePeriod(account.period ?? DEFAULT_PERIOD)
  account.counter = account.type === 'hotp' ? Math.max(0, Math.trunc(Number(account.counter) || 0)) : 0
  account.encoding = account.encoding === 'steam' ? 'steam' : 'standard'
  account.groupIds = normalizeGroupIds(account.groupIds)
  account.color = safeColor(account.color || colorFor(account.issuer || account.name))
  account.icon = String(account.icon || '').trim() || initials(account.issuer || account.name)
  account.favorite = Boolean(account.favorite)
  account.quick = Boolean(account.quick)
  account.note = String(account.note || '')
  account.deletedAt = account.deletedAt || null
  // 上面逐个字段补过一遍，入参的键都还在，secret 和 groupIds 也一定有了。
  return account as T & Account & { secret: string, groupIds: string[] }
}

// 同一个密钥 + 同一个账号名视为同一条，导入时用它去重。
/** 生成用于导入去重的账号键。
 * @param account 账号数据。
 * @returns 密钥、服务商和账号名组成的键。
 */
export function accountKey(account: Account): string {
  return [normalizeSecret(account.secret), account.issuer?.toLowerCase() || '', account.name?.toLowerCase() || ''].join('|')
}

/** 将数组中的项目移动到目标项目的位置。
 * @param items 含有 `id` 的项目数组。
 * @param sourceId 被移动项目的标识。
 * @param targetId 目标项目的标识。
 * @returns 移动后的新数组，找不到项目时返回原数组。
 */
export function moveItem<T extends { id: string }>(items: T[], sourceId: string, targetId: string): T[] {
  const from = items.findIndex(item => item.id === sourceId)
  const to = items.findIndex(item => item.id === targetId)
  if (from < 0 || to < 0 || from === to) return items
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** 校验备份状态的基本结构。
 * @param value 待校验的备份数据。
 * @returns 经校验的备份状态。
 * @throws 数据结构无效时抛出错误。
 */
export function validateState(value: unknown): BackupState {
  if (!value || typeof value !== 'object') throw new Error('不是有效的 FunOTP 备份')
  const state = value as Partial<BackupState>
  if (state.version !== 1 || !Array.isArray(state.groups) || !Array.isArray(state.accounts)) {
    throw new Error('不是有效的 FunOTP 备份')
  }
  return state as BackupState
}

// 密钥算不出验证码的账号留着也只会报错，直接丢掉，但不因为一条脏数据让整次恢复失败。
/** 清理备份状态中的无效账号和分组引用。
 * @param value 已校验的备份状态。
 * @returns 清理后的状态及被丢弃账号数量。
 */
export function migrateState(value: BackupState): { state: BackupState, dropped: number } {
  const accounts = value.accounts.filter(account => isValidSecret(account?.secret)).map(normalizeAccount)
  const groups = value.groups
    .filter(group => group?.id)
    .map(group => ({ id: group.id, name: String(group.name || '').trim() || '未命名分组' }))
  const known = new Set(groups.map(group => group.id))
  accounts.forEach(account => { account.groupIds = account.groupIds.filter(id => known.has(id)) })
  return { state: { ...value, groups, accounts }, dropped: value.accounts.length - accounts.length }
}
