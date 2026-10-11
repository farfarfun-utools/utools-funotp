<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { accountLabel, initials, safeColor } from '../lib/core'

const props = defineProps({
  account: { type: Object, required: true },
  code: { type: String, default: '' },
  nextCode: { type: String, default: '' },
  seconds: { type: Number, default: 0 },
  // 每次插件重新进入时 +1，让圆环按当前时钟重新对齐（机器睡过一觉、或系统时间被改过）。
  ringSync: { type: Number, default: 0 },
  // 被方向键选中。点击选中不走这条路，所以选中框只在键盘操作时出现。
  active: Boolean,
  showNext: Boolean,
  trashView: Boolean,
  hasError: Boolean,
})
const emit = defineEmits(['copy', 'context-menu', 'edit', 'favorite', 'drag-start', 'drop'])

const card = ref(null)

// 选中后把焦点落到卡片上：焦点会自动把它滚进可视区，读屏软件也跟着念出来。
// article 带 tabindex="-1"，所以 Tab 不会一张张走过几十张卡片。
watch(() => props.active, isActive => {
  if (isActive) card.value?.focus()
})

const RADIUS = 13
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// 最后 5 秒变红并提示下一个码，避免复制到马上失效的验证码。
const expiring = computed(() => props.account.type === 'totp' && props.seconds <= 5)

// 只在周期改变或重新对齐时算一次；圆环本身由 CSS 动画推进，不占渲染。
const ring = computed(() => {
  void props.ringSync
  const period = Number(props.account.period) || 30
  return {
    '--ring-circumference': String(CIRCUMFERENCE),
    '--ring-duration': `${period}s`,
    '--ring-delay': `${-(Date.now() / 1000 % period)}s`,
  }
})
const title = computed(() => props.account.issuer || props.account.name || '未命名')
const subtitle = computed(() => (props.account.issuer ? props.account.name : '') || '')
</script>

<template>
  <article
    ref="card"
    class="otp-card"
    :class="{ expiring, invalid: hasError, trashed: trashView, active }"
    tabindex="-1"
    :draggable="!trashView"
    :title="trashView ? accountLabel(account) : `点击复制 ${accountLabel(account)} 的验证码`"
    @click="!trashView && emit('copy', account)"
    @contextmenu.prevent="emit('context-menu', account, $event)"
    @dragstart="emit('drag-start', account.id, $event)"
    @dragover.prevent
    @drop.prevent="emit('drop', account.id)"
  >
    <span class="otp-avatar" :style="{ '--avatar-color': safeColor(account.color) }" aria-hidden="true">
      {{ account.icon || initials(title) }}
    </span>

    <div class="otp-body">
      <div class="otp-heading">
        <h2 :title="title">{{ title }}</h2>
        <i v-if="account.favorite" class="iconfont icon-card otp-flag" title="常用" aria-hidden="true" />
        <i v-if="account.quick" class="iconfont icon-quick-fill otp-flag" title="已注册 uTools 关键字" aria-hidden="true" />
      </div>
      <p v-if="subtitle" class="otp-subtitle" :title="subtitle">{{ subtitle }}</p>
      <p class="otp-code" :class="{ masked: !hasError && code.startsWith('•') }">{{ code }}</p>
      <p v-if="showNext && expiring && nextCode" class="otp-next">下一个 {{ nextCode }}</p>
    </div>

    <div class="otp-timer">
      <template v-if="account.type === 'hotp'">
        <span class="otp-counter" title="HOTP 计数器，复制后自动加一">#{{ account.counter }}</span>
      </template>
      <template v-else>
        <svg class="otp-ring" viewBox="0 0 32 32" aria-hidden="true" :style="ring">
          <circle class="otp-ring-track" cx="16" cy="16" :r="RADIUS" />
          <circle class="otp-ring-value" cx="16" cy="16" :r="RADIUS" :stroke-dasharray="CIRCUMFERENCE" />
        </svg>
        <span class="otp-seconds" :aria-label="`${seconds} 秒后刷新`">{{ seconds }}</span>
      </template>
    </div>

    <div class="otp-actions">
      <button type="button" :title="account.favorite ? '取消常用' : '加入常用'" @click.stop="emit('favorite', account)">
        <i class="iconfont icon-card" aria-hidden="true" />
      </button>
      <button type="button" title="编辑" @click.stop="emit('edit', account)">
        <i class="iconfont icon-edit" aria-hidden="true" />
      </button>
    </div>
  </article>
</template>
