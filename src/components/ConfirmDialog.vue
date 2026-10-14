<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { ConfirmOptions } from '../lib/core'

// window.confirm 在 uTools 里弹的是 Chromium 自带的系统对话框：样式跟插件完全两套，
// 还会把整个渲染进程同步卡住（倒计时和验证码在那期间是停着的）。
// 换成和其他弹窗同一套样式的 <dialog>，并保留「必须明确点确定才继续」这件事。
const DEFAULTS: ConfirmOptions = { message: '', detail: '', confirmText: '确定', danger: false }

const dialog = ref(null)
const confirmButton = ref(null)
const options = ref<ConfirmOptions>({ ...DEFAULTS })
let settle: ((result: boolean) => void) | null = null

function ask(next: ConfirmOptions): Promise<boolean> {
  // 上一次还挂着就先按取消结算掉，否则那个调用方会一直 await 在那儿。
  settle?.(false)
  settle = null
  options.value = { ...DEFAULTS, ...next }
  return new Promise(resolve => {
    settle = resolve
    if (!dialog.value.open) dialog.value.showModal()
    // 焦点落在确定上：危险操作也一样，用户是自己点开这个确认框的，Esc 和取消都在手边。
    nextTick(() => confirmButton.value?.focus())
  })
}

// close 事件也会走到这里（Esc、或者 dialog.close() 之后），settle 已经置空所以不会重复结算。
function finish(result: boolean) {
  const resolve = settle
  settle = null
  dialog.value?.close()
  resolve?.(result)
}

defineExpose({ ask })
</script>

<template>
  <dialog
    ref="dialog"
    class="otp-dialog confirm-dialog"
    aria-labelledby="confirm-dialog-title"
    @cancel.prevent="finish(false)"
    @close="finish(false)"
  >
    <header class="otp-dialog-header">
      <span class="otp-dialog-avatar plain" :class="{ danger: options.danger }">
        <i class="iconfont" :class="options.danger ? 'icon-delete' : 'icon-remarks'" aria-hidden="true" />
      </span>
      <div>
        <h2 id="confirm-dialog-title">{{ options.message }}</h2>
        <p v-if="options.detail">{{ options.detail }}</p>
      </div>
    </header>

    <footer class="otp-dialog-footer">
      <button type="button" class="button" @click="finish(false)">取消</button>
      <button ref="confirmButton" type="button" class="button primary" :class="{ danger: options.danger }" @click="finish(true)">
        {{ options.confirmText }}
      </button>
    </footer>
  </dialog>
</template>
