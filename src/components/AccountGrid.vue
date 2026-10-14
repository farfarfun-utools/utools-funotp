<script setup lang="ts">
import { ref } from 'vue'
import AccountCard from './AccountCard.vue'
import emptyImage from '../assets/empty.svg'
import emptyDarkImage from '../assets/empty-dark.svg'
import type { PropType } from 'vue'
import type { Account, CodeView } from '../lib/core'

const EMPTY_VIEW: CodeView = { code: '······', next: '', invalid: false }

const props = defineProps({
  accounts: { type: Array as PropType<Account[]>, required: true },
  // 账号 id → 验证码展示形态。整格共用一份，秒级心跳不会让它重算。
  views: { type: Object as PropType<Map<string, CodeView>>, required: true },
  // 当前时刻。倒计时秒数由卡片自己从它算，少一个每秒都要重新生成的函数 prop。
  now: { type: Number, required: true },
  // 每次插件重新进入时 +1，让圆环按当前时钟重新对齐。
  ringSync: { type: Number, default: 0 },
  columns: { type: Number, default: 0 },
  // 方向键选中的账号 id，空串表示没有选中。
  activeId: { type: String, default: '' },
  showNext: Boolean,
  trashView: Boolean,
  showAdd: Boolean,
  emptyText: { type: String, default: '还没有账号' },
})
const emit = defineEmits(['add', 'copy', 'edit', 'favorite', 'context-menu', 'drag-start', 'drop'])

const grid = ref(null)

// 卡片刚出现、码还没算出来的那一瞬间 views 里还没有它。
function viewOf(id) {
  return props.views.get(id) || EMPTY_VIEW
}

// 上下键要跨行走，得知道一行有几列。columns 设成「自适应」时列数由容器宽度决定，
// 配置里读不出来，只能问浏览器：gridTemplateColumns 的实际值会把每一列的像素宽度列出来。
// 按键时才量一次，省掉 ResizeObserver，也不会量到过期的布局。
function columnCount() {
  if (!grid.value) return 1
  const used = getComputedStyle(grid.value).gridTemplateColumns
  return Math.max(1, used.split(' ').filter(Boolean).length)
}

defineExpose({ columnCount })
</script>

<template>
  <section class="card-list" aria-live="polite">
    <div
      v-if="accounts.length"
      ref="grid"
      class="otp-grid"
      :style="columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : null"
    >
      <AccountCard
        v-for="account in accounts"
        :key="account.id"
        :account="account"
        :view="viewOf(account.id)"
        :now="now"
        :ring-sync="ringSync"
        :active="account.id === activeId"
        :show-next="showNext"
        :trash-view="trashView"
        @copy="emit('copy', $event)"
        @edit="emit('edit', $event)"
        @favorite="emit('favorite', $event)"
        @context-menu="(account, event) => emit('context-menu', account, event)"
        @drag-start="(id, event) => emit('drag-start', id, event)"
        @drop="emit('drop', $event)"
      />
      <button v-if="showAdd" class="add-item" type="button" aria-label="添加账号" @click="emit('add')">
        <i class="iconfont icon-add" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="otp-empty">
      <img class="empty-image-light" :src="emptyImage" alt="" />
      <img class="empty-image-dark" :src="emptyDarkImage" alt="" />
      <span>{{ emptyText }}</span>
      <button v-if="showAdd" type="button" class="button primary" @click="emit('add')">添加账号</button>
    </div>
  </section>
</template>
