<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { PropType } from 'vue'
import type { Group } from '../lib/core'

defineProps({
  groups: { type: Array as PropType<Group[]>, required: true },
  groupCount: { type: Function as PropType<(groupId: string) => number>, required: true },
})
const emit = defineEmits(['add', 'action'])
const dialog = ref(null)
const nameField = ref(null)
const newName = ref('')
const editingId = ref('')
const editingName = ref('')

function open() {
  newName.value = ''
  editingId.value = ''
  if (!dialog.value.open) dialog.value.showModal()
  nextTick(() => nameField.value?.focus())
}

function close() {
  dialog.value?.close()
}

function submitNew() {
  emit('add', newName.value)
  newName.value = ''
  nameField.value?.focus()
}

function startRename(group) {
  editingId.value = group.id
  editingName.value = group.name
}

function commitRename() {
  if (editingId.value) emit('action', editingId.value, 'rename', editingName.value)
  editingId.value = ''
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="otp-dialog group-dialog" aria-labelledby="group-dialog-title" @cancel.prevent="close">
    <header class="otp-dialog-header">
      <span class="otp-dialog-avatar plain"><i class="iconfont icon-cat" aria-hidden="true" /></span>
      <div>
        <h2 id="group-dialog-title">管理分组</h2>
        <p>删除分组不会删除账号，只是取消归属</p>
      </div>
      <button type="button" class="dialog-close" aria-label="关闭" @click="close">×</button>
    </header>

    <div class="otp-dialog-body">
      <form class="group-add" @submit.prevent="submitNew">
        <input ref="nameField" v-model="newName" placeholder="新分组名称" aria-label="新分组名称" />
        <button type="submit" class="button primary" :disabled="!newName.trim()">添加</button>
      </form>

      <ul v-if="groups.length" class="group-list">
        <li v-for="(group, index) in groups" :key="group.id">
          <input
            v-if="editingId === group.id"
            v-model="editingName"
            class="group-rename"
            aria-label="分组名称"
            @blur="commitRename"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="editingId = ''"
          />
          <template v-else>
            <span class="group-name">{{ group.name }}</span>
            <small>{{ groupCount(group.id) }} 个账号</small>
          </template>
          <span class="group-actions">
            <button type="button" title="上移" :disabled="index === 0" @click="emit('action', group.id, 'up')">↑</button>
            <button type="button" title="下移" :disabled="index === groups.length - 1" @click="emit('action', group.id, 'down')">↓</button>
            <button type="button" title="重命名" @click="startRename(group)"><i class="iconfont icon-edit" aria-hidden="true" /></button>
            <button type="button" class="danger-text" title="删除" @click="emit('action', group.id, 'delete')"><i class="iconfont icon-delete" aria-hidden="true" /></button>
          </span>
        </li>
      </ul>
      <p v-else class="group-empty">还没有分组，账号多了以后可以分组管理。</p>
    </div>

    <footer class="otp-dialog-footer">
      <button type="button" class="button primary" @click="close">完成</button>
    </footer>
  </dialog>
</template>
