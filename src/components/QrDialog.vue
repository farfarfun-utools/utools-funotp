<script setup lang="ts">
import { ref } from 'vue'
import { accountLabel } from '../lib/core'
import { buildOtpauthUri } from '../lib/otpauth'
import { toQrDataUrl } from '../lib/qr'

const emit = defineEmits(['copy', 'message'])
const dialog = ref(null)
const account = ref(null)
const image = ref('')
const uri = ref('')
const revealed = ref(false)
let renderToken = 0

function reset() {
  renderToken += 1
  account.value = null
  image.value = ''
  uri.value = ''
  revealed.value = false
}

async function open(value) {
  const token = (renderToken += 1)
  account.value = value
  revealed.value = false
  image.value = ''
  uri.value = buildOtpauthUri(value)
  if (!dialog.value.open) dialog.value.showModal()
  try {
    const dataUrl = await toQrDataUrl(uri.value)
    if (token !== renderToken || !dialog.value?.open) return
    image.value = dataUrl
  } catch (error) {
    if (token !== renderToken || !dialog.value?.open) return
    emit('message', `二维码生成失败：${error.message}`, true)
  }
}

function close() {
  // 关掉对话框就把二维码丢掉，免得下次打开时先闪一下上一个账号的码。
  reset()
  dialog.value?.close()
}

function closeOnBackdrop(event) {
  if (event.target === dialog.value) close()
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="otp-dialog qr-dialog" aria-labelledby="qr-dialog-title" @click="closeOnBackdrop" @cancel.prevent="close" @close="reset">
    <header class="otp-dialog-header">
      <div>
        <h2 id="qr-dialog-title">导出到其他设备</h2>
        <p v-if="account">{{ accountLabel(account) }}</p>
      </div>
      <button type="button" class="dialog-close" aria-label="关闭" @click="close">×</button>
    </header>

    <div class="otp-dialog-body qr-body">
      <div class="qr-frame" :class="{ blurred: !revealed }">
        <img v-if="image" :src="image" alt="账号二维码" />
        <div v-else class="qr-placeholder">生成中…</div>
        <button v-if="!revealed" type="button" class="qr-reveal" @click="revealed = true">点击显示二维码</button>
      </div>
      <p class="qr-warning">
        二维码与链接都包含<b>明文密钥</b>，扫到的人可以生成你的验证码。请确认周围没有摄像头或旁观者。
      </p>
      <button type="button" class="button block" @click="emit('copy', uri)">复制 otpauth 链接</button>
    </div>
  </dialog>
</template>
