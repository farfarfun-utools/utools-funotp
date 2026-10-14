/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// 只声明本插件真正用到的那几个 uTools 接口。宿主注入的是整个 utools 对象，
// 但在浏览器里 pnpm dev 预览时它根本不存在，所以每一项都是可选的。
// 刻意不加 [key: string]: unknown 兜底：加了的话把方法名拼错（uTools 自己就有
// setExpandHeight / setExpendHeight 这种坑）也能通过类型检查，到运行时才变成一个静默的 no-op。
// 用到新接口就来这里补一条。参考 https://next.u-tools.cn/docs/developer/api.html
interface UToolsFeatureCmd {
  type?: string
  label?: string
  match?: string | RegExp
}

interface UToolsFeature {
  code: string
  explain?: string
  description?: string
  icon?: string
  platform?: string[]
  /** 命中后直接隐藏主窗口，不进插件界面。 */
  mainHide?: boolean
  cmds: (string | UToolsFeatureCmd)[]
}

interface UToolsAction {
  code: string
  type: string
  payload: unknown
  optional?: unknown[]
}

interface UToolsPushItem {
  title: string
  description?: string
  icon?: string
  [key: string]: unknown
}

interface UToolsDbStorage {
  getItem: (key: string) => unknown
  setItem: (key: string, value: unknown) => void
  removeItem: (key: string) => void
}

interface UToolsApi {
  copyText?: (text: string) => boolean

  hideMainWindow?: (isFocusPrevWindow?: boolean) => boolean
  showMainWindow?: () => boolean
  outPlugin?: (isKill?: boolean) => boolean

  /** uTools 8.0 的名字。 */
  setExpandHeight?: (height: number) => boolean
  /** 8.0 之前的拼写，老版本只认这个。 */
  setExpendHeight?: (height: number) => boolean

  setSubInput?: (
    onChange: (details: { text: string }) => void,
    placeholder?: string,
    isFocus?: boolean,
  ) => boolean
  /** 回填子输入框的内容。uTools 不提供读取接口，值只能自己从 onChange 里跟着记。 */
  setSubInputValue?: (text: string) => boolean
  /** 让子输入框失去焦点，焦点交给插件页面——子输入框属于主窗口，不这样做插件收不到按键。 */
  subInputBlur?: () => boolean

  onPluginEnter?: (callback: (action: UToolsAction) => void) => void
  onPluginOut?: (callback: (isKill: boolean) => void) => void
  onMainPush?: (
    callback: (action: UToolsAction) => UToolsPushItem[],
    onSelect?: (action: UToolsAction & { option?: UToolsPushItem }) => boolean | void,
  ) => void

  setFeature?: (feature: UToolsFeature) => boolean
  removeFeature?: (code: string) => boolean
  getFeatures?: (codes?: string[]) => UToolsFeature[]

  /** uTools 8.0 回调和 Promise 两种形式都支持；Promise 形式在用户取消时 reject。
   *  这里仍然用回调，因为老版本只有回调形式。 */
  screenCapture?: {
    (callback: (dataUrl: string) => void): void
    (): Promise<string>
  }

  dbStorage?: UToolsDbStorage
}

interface WebdavConfig {
  host: string
  username: string
  password: string
}

/** utools/preload.js 挂到 window.funotp 上的桥，渲染进程靠它做文件和 WebDav 操作。
 * 这里的每一项都要和 preload.js 里的实现一一对应。 */
interface FunOtpBridge {
  onEnter: (callback: (action: UToolsAction) => void) => void
  /** 返回 false 表示用户在保存框里点了取消。 */
  saveBackup: (content: string, defaultName: string) => boolean
  /** 返回 null 表示用户取消选择。 */
  chooseTextFile: (extensions: string[]) => string | null
  /** 读成 data URL，渲染层可以直接丢给 <img> 解二维码。返回 null 表示取消。 */
  chooseImageFile: () => string | null
  webdavBackup: (config: WebdavConfig, content: string) => Promise<void>
  webdavList: (config: WebdavConfig) => Promise<string>
  webdavRestore: (config: WebdavConfig, href: string) => Promise<string>
  webdavDelete: (config: WebdavConfig, href: string) => Promise<void>
}

interface Window {
  funotp?: FunOtpBridge
  utools?: UToolsApi
}
