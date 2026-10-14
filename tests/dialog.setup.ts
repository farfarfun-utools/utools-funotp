// jsdom 到 30 还没实现 <dialog> 的 show / showModal / close，确认框和 WebDav 列表都挂在这几个方法上，
// 不补的话组件测试一调用就抛 TypeError。这里只补到「open 属性和 close 事件是对的」为止——
// 组件的逻辑只认这两样。真实环境是 Chromium 132，原生就有，补丁只存在于测试里。
// 环境是 node 的那些测试（src/lib、utools/webdav.js）没有 DOM，直接跳过。
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  function open(this: HTMLDialogElement) {
    this.open = true
  }

  HTMLDialogElement.prototype.show = open
  HTMLDialogElement.prototype.showModal = open
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    // 原生 close 对已经关着的弹窗什么都不做，不会再发一次 close 事件。
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
