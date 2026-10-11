<script setup lang="ts">
import type { PropType } from 'vue'
import type { Group } from '../lib/core'

defineProps({
  groups: { type: Array as PropType<Group[]>, required: true },
  currentView: { type: String, required: true },
  theme: { type: String, required: true },
  rounded: { type: Number, default: 36 },
  hasUngrouped: Boolean,
})
const emit = defineEmits(['select', 'manage', 'add', 'cycle-theme', 'settings'])
</script>

<template>
  <header class="header">
    <nav
      class="top-nav"
      aria-label="账号分组"
      :style="{ borderRadius: `0 0 ${rounded}px ${rounded}px` }"
      @contextmenu.prevent="emit('manage', $event)"
    >
      <div class="top-nav-scroll">
        <button type="button" :class="{ active: currentView === 'all' }" @click="emit('select', 'all')"><span>全部</span></button>
        <button type="button" :class="{ active: currentView === 'favorites' }" @click="emit('select', 'favorites')"><span>常用</span></button>
        <button
          v-for="group in groups"
          :key="group.id"
          type="button"
          :class="{ active: currentView === `group:${group.id}` }"
          @click="emit('select', `group:${group.id}`)"
        >
          <span>{{ group.name }}</span>
        </button>
        <button v-if="hasUngrouped && groups.length" type="button" :class="{ active: currentView === 'ungrouped' }" @click="emit('select', 'ungrouped')">
          <span>未分组</span>
        </button>
      </div>

      <span class="nav-spacer" />
      <button class="round-button" type="button" title="管理分组" aria-label="管理分组" @click.stop="emit('manage', $event)">
        <i class="iconfont icon-cat" aria-hidden="true" />
      </button>
      <button class="round-button" type="button" title="添加账号" aria-label="添加账号" @click.stop="emit('add')">
        <i class="iconfont icon-add-circle" aria-hidden="true" />
      </button>
      <button class="round-button theme-button" type="button" title="切换主题" aria-label="切换主题" @click.stop="emit('cycle-theme')">
        <i class="iconfont" :class="theme === 'dark' ? 'icon-dark' : theme === 'light' ? 'icon-light' : 'icon-system'" aria-hidden="true" />
      </button>
      <button class="round-button" type="button" title="设置" aria-label="设置" @click.stop="emit('settings')">
        <i class="iconfont icon-setting" aria-hidden="true" />
      </button>
    </nav>
  </header>
</template>
