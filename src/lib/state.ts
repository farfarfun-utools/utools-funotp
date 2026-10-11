import { migrateState, validateState } from './core'

// 纯状态逻辑：不依赖 vue / uTools，方便直接跑单测。
export const STORAGE_KEY = 'funotp-state-v1'

export const DEFAULT_SETTINGS = {
  // columns 为 0 表示按窗口宽度自适应。
  display: { columns: 0, groupDigits: true, maskCode: false, showNext: true, sort: 'manual' },
  copy: { outPlugin: true, copyOnEnter: false },
  search: ['name', 'issuer', 'note'],
  navbar: { rounded: 36 },
}

export function emptyState() {
  return {
    version: 1,
    theme: 'system',
    currentView: 'all',
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    groups: [],
    accounts: [],
  }
}

export function hydrateState(state) {
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
    display: { ...DEFAULT_SETTINGS.display, ...state.settings?.display },
    copy: { ...DEFAULT_SETTINGS.copy, ...state.settings?.copy },
    navbar: { ...DEFAULT_SETTINGS.navbar, ...state.settings?.navbar },
    search: state.settings?.search?.length ? state.settings.search : DEFAULT_SETTINGS.search.slice(),
  }
  state.theme ||= 'system'
  state.currentView ||= 'all'
  // 记住的分组可能已经被删掉了，回落到「全部」而不是停在空白页。
  if (state.currentView.startsWith('group:') && !state.groups.some(group => group.id === state.currentView.slice(6))) {
    state.currentView = 'all'
  }
  return state
}

// 方向键移动选中卡片。放在这里是因为它是纯计算，可以直接单测，不用把整个 composable 架起来。
/** 计算方向键移动后的选中下标。
 * @param current 当前下标，-1 表示还没有显式选中。
 * @param delta 位移，正数往后、负数往前；上下键传的是一行的列数。
 * @param total 列表长度。
 * @returns 夹在列表范围内的新下标，列表为空时返回 -1。
 */
export function nextIndex(current, delta, total) {
  if (total <= 0) return -1
  // 还没选中时，往后走从第一张开始，往前走从最后一张开始。
  if (current < 0) return delta > 0 ? 0 : total - 1
  return Math.min(Math.max(current + delta, 0), total - 1)
}

export function prepareState(saved) {
  const { state, dropped } = migrateState(validateState(saved))
  return { state: hydrateState(state), dropped }
}

// 读不出来时绝不能拿空数据顶上——那会在下一次写入时覆盖掉用户的真实密钥。
// 返回 blocked 时由界面提示用户，并暂停一切写入。
export function loadState({ read }) {
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
