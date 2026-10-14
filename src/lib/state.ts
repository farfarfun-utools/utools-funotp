import { SEARCH_FIELDS, migrateState, validateState } from './core'
import type { BackupState, StoredAccount } from './core'

// 纯状态逻辑：不依赖 vue / uTools，方便直接跑单测。
export const STORAGE_KEY = 'funotp-state-v1'

// 分组视图既是界面状态也是会落盘的字段。前缀和它的长度原来在三处被手写（两个文件里的 slice(6)）。
export const GROUP_VIEW_PREFIX = 'group:'

/** 生成分组对应的视图标识。
 * @param groupId 分组标识。
 * @returns 形如 `group:<id>` 的视图标识。
 */
export function groupView(groupId: string): string {
  return `${GROUP_VIEW_PREFIX}${groupId}`
}

/** 从视图标识中取回分组标识。
 * @param view 当前视图标识。
 * @returns 分组标识，不是分组视图时返回空串。
 */
export function groupIdOf(view: unknown): string {
  const text = String(view || '')
  return text.startsWith(GROUP_VIEW_PREFIX) ? text.slice(GROUP_VIEW_PREFIX.length) : ''
}

export interface FunOtpSettings {
  display: { columns: number, groupDigits: boolean, maskCode: boolean, showNext: boolean, sort: string }
  copy: { outPlugin: boolean, copyOnEnter: boolean }
  search: string[]
  navbar: { rounded: number }
}

export interface FunOtpState extends BackupState {
  theme: string
  currentView: string
  settings: FunOtpSettings
  accounts: StoredAccount[]
}

export interface LoadedState {
  state: FunOtpState
  blocked: string
  dropped: number
}

export type StateReader = (key: string) => unknown

export const DEFAULT_SETTINGS: FunOtpSettings = {
  // columns 为 0 表示按窗口宽度自适应。
  display: { columns: 0, groupDigits: true, maskCode: false, showNext: true, sort: 'manual' },
  copy: { outPlugin: true, copyOnEnter: false },
  search: [...SEARCH_FIELDS],
  navbar: { rounded: 36 },
}

/** 创建一份可直接使用的空白应用状态。
 * @returns 含默认设置、分组和账号列表的状态。
 */
export function emptyState(): FunOtpState {
  return {
    version: 1,
    theme: 'system',
    currentView: 'all',
    settings: structuredClone(DEFAULT_SETTINGS),
    groups: [],
    accounts: [],
  }
}

// 返回新对象而不是原地改入参：名字读起来像纯函数，之前却会把传进来的备份对象改掉，
// 调用链上恰好没人复用那个对象才没出问题。
/** 补全备份状态缺失的界面设置，并修正失效的当前分组。
 * @param state 已通过基本结构校验的备份状态。
 * @returns 可供界面使用的完整状态，入参不会被修改。
 */
export function hydrateState(state: BackupState): FunOtpState {
  const settings = state.settings as Partial<FunOtpSettings> | undefined
  const hydrated: FunOtpState = {
    ...(state as FunOtpState),
    theme: String(state.theme || '') || 'system',
    currentView: String(state.currentView || '') || 'all',
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      display: { ...DEFAULT_SETTINGS.display, ...settings?.display },
      copy: { ...DEFAULT_SETTINGS.copy, ...settings?.copy },
      navbar: { ...DEFAULT_SETTINGS.navbar, ...settings?.navbar },
      search: settings?.search?.length ? [...settings.search] : [...SEARCH_FIELDS],
    },
  }
  // 记住的分组可能已经被删掉了，回落到「全部」而不是停在空白页。
  const groupId = groupIdOf(hydrated.currentView)
  if (groupId && !hydrated.groups.some(group => group.id === groupId)) hydrated.currentView = 'all'
  return hydrated
}

// 方向键移动选中卡片。放在这里是因为它是纯计算，可以直接单测，不用把整个 composable 架起来。
/** 计算方向键移动后的选中下标。
 * @param current 当前下标，-1 表示还没有显式选中。
 * @param delta 位移，正数往后、负数往前；上下键传的是一行的列数。
 * @param total 列表长度。
 * @returns 夹在列表范围内的新下标，列表为空时返回 -1。
 */
export function nextIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return -1
  // 还没选中时，往后走从第一张开始，往前走从最后一张开始。
  if (current < 0) return delta > 0 ? 0 : total - 1
  return Math.min(Math.max(current + delta, 0), total - 1)
}

/** 校验、迁移并补全导入或读取到的备份状态。
 * @param saved 任意来源的待恢复数据。
 * @returns 完整状态及迁移时丢弃的无效账号数量。
 * @throws 备份结构无效时抛出错误。
 */
export function prepareState(saved: unknown): { state: FunOtpState, dropped: number } {
  const { state, dropped } = migrateState(validateState(saved))
  return { state: hydrateState(state), dropped }
}

// 读不出来时绝不能拿空数据顶上——那会在下一次写入时覆盖掉用户的真实密钥。
// 返回 blocked 时由界面提示用户，并暂停一切写入。
/** 从存储读取应用状态，读取或解析失败时返回只读保护状态。
 * @param options.read 按键读取原始数据的函数。
 * @returns 状态、只读错误提示及被迁移丢弃的账号数量。
 */
export function loadState({ read }: { read: StateReader }): LoadedState {
  let saved
  try {
    saved = read(STORAGE_KEY)
  } catch (error) {
    return { state: emptyState(), blocked: `本地数据读取失败：${error.message}。`, dropped: 0 }
  }
  if (!saved) return { state: emptyState(), blocked: '', dropped: 0 }
  try {
    const { state, dropped } = prepareState(saved)
    return { state, blocked: '', dropped }
  } catch (error) {
    return { state: emptyState(), blocked: `本地数据无法解析：${error.message}。`, dropped: 0 }
  }
}
