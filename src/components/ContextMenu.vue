<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { PropType } from 'vue'

interface MenuItem {
  action: string
  label: string
  icon?: string
  danger?: boolean
  /** 在这一项后面画一条分隔线。 */
  divided?: boolean
}

const props = defineProps({
  items: { type: Array as PropType<MenuItem[]>, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
})
const emit = defineEmits(['select'])
const menu = ref(null)
const position = ref({ left: `${props.x}px`, top: `${props.y}px` })

// 贴着视窗边缘弹出时把菜单拉回来，否则最后几项会被裁掉。
watch(() => [props.x, props.y, props.items], async () => {
  await nextTick()
  const width = menu.value?.offsetWidth || 150
  const height = menu.value?.offsetHeight || 100
  position.value = {
    left: `${Math.max(8, Math.min(props.x, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, window.innerHeight - height - 8))}px`,
  }
  const first = menu.value?.querySelector('button[role="menuitem"]')
  first?.focus()
}, { immediate: true })

function handleMenuKeydown(event: KeyboardEvent) {
  const buttons = [...(menu.value?.querySelectorAll('button[role="menuitem"]') || [])]
  if (!buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    buttons[(index + 1) % buttons.length]?.focus()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
  } else if (event.key === 'Home') {
    event.preventDefault()
    buttons[0]?.focus()
  } else if (event.key === 'End') {
    event.preventDefault()
    buttons[buttons.length - 1]?.focus()
  }
}
</script>

<template>
  <div ref="menu" class="context-menu" role="menu" :style="position" @click.stop @keydown="handleMenuKeydown">
    <template v-for="item in items" :key="item.action">
      <button type="button" role="menuitem" :class="{ danger: item.danger }" @click="emit('select', item.action)">
        <i v-if="item.icon" class="iconfont menu-icon" :class="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
      <span v-if="item.divided" class="menu-divider" />
    </template>
  </div>
</template>
