<script setup lang="ts">
import { reactive, ref, toRaw } from 'vue'
import type { PropType } from 'vue'
import type { ConfirmOptions, Group } from '../lib/core'
import { readStorage, writeStorage } from '../lib/storage'

const props = defineProps({
  settings: { type: Object, required: true },
  groups: { type: Array as PropType<Group[]>, default: () => [] },
  accountCount: { type: Number, default: 0 },
  // 备份内容由 useFunOtp 产出，这里不自己序列化一份——两条备份路径必须是同一份数据。
  backupContent: { type: Function as PropType<() => string>, required: true },
  // 删云端备份这种不可撤销的操作要先问一句，用的是和其他弹窗同一个确认框。
  confirm: { type: Function as PropType<(options: ConfirmOptions) => Promise<boolean>>, required: true },
})
const emit = defineEmits(['save-settings', 'export', 'export-uris', 'data-file', 'message'])

const dialog = ref(null)
const webdavDialog = ref(null)
const webdavListDialog = ref(null)
const restoreInput = ref(null)
const importInput = ref(null)
const activeTab = ref('display')
const importGroupId = ref('')
const snapshot = ref('')
const webdav = reactive({ host: '', username: '', password: '' })
const webdavLoading = ref(false)
const webdavFiles = ref([])

function open() {
  activeTab.value = 'display'
  snapshot.value = JSON.stringify(props.settings)
  if (!dialog.value.open) dialog.value.showModal()
}

function close() {
  if (snapshot.value !== JSON.stringify(props.settings)) emit('save-settings')
  dialog.value?.close()
}

function closeOnBackdrop(event) {
  if (event.target === dialog.value) close()
}

// uTools 里走原生文件框；浏览器预览时回落到隐藏的 file input。
function choose(type) {
  const extensions = type === 'restore' ? ['json'] : ['txt', 'json', 'text']
  let content
  try {
    content = window.funotp?.chooseTextFile?.(extensions)
  } catch (error) {
    // 读文件失败（权限、文件被占用）必须说出来，否则「从电脑还原」看起来就是点了没反应。
    return emit('message', error.message, true)
  }
  if (typeof content === 'string') emit('data-file', type, content, { groupId: importGroupId.value })
  else if (content === undefined) (type === 'restore' ? restoreInput : importInput).value?.click()
}

async function readFile(type, event) {
  const file = event.target.files[0]
  event.target.value = ''
  if (file) emit('data-file', type, await file.text(), { groupId: importGroupId.value })
}

function toggleSearch(field) {
  const search = props.settings.search
  const index = search.indexOf(field)
  if (index >= 0) search.splice(index, 1)
  else search.push(field)
}

const EMPTY_WEBDAV = { host: '', username: '', password: '' }

// preload 收到的必须是纯对象：Vue 的响应式代理过不了 Electron 的桥。
function webdavConfig() {
  return { ...toRaw(webdav) }
}

function openWebdav() {
  Object.assign(webdav, EMPTY_WEBDAV, readStorage('funotp-webdav', EMPTY_WEBDAV))
  webdavDialog.value.showModal()
}

function saveWebdav() {
  try {
    writeStorage('funotp-webdav', webdavConfig())
  } catch (error) {
    // 整个 dbStorage 坏掉时这里也会抛，不接住的话配置看起来保存成功了，实际没落盘。
    return emit('message', `WebDav 配置保存失败：${error.message}`, true)
  }
  webdavDialog.value.close()
  emit('message', 'WebDav 配置已保存')
}

function parseWebdavList(xml) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  // parseFromString 从不抛错，畸形响应会变成一棵带 parsererror 的树，不查就会静默显示「暂无数据」。
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('服务器返回的不是有效的 WebDav 响应')
  // 网关的错误页也可能是合法 XML（`<!DOCTYPE html><title>502</title>` 这种），parsererror 查不出来。
  // 根节点不是 multistatus 就不是 PROPFIND 的回应，照样得报错——否则「列不出文件」和「目录是空的」看起来一模一样。
  if (parsed.documentElement?.localName !== 'multistatus') throw new Error('服务器返回的不是有效的 WebDav 响应')
  return [...parsed.getElementsByTagNameNS('*', 'response')].flatMap(response => {
    const value = name => response.getElementsByTagNameNS('*', name)[0]?.textContent || ''
    const href = value('href')
    if (!decodeURIComponent(href).endsWith('.json')) return []
    // 服务器给的日期不一定能解析，解析不出来就按最旧处理，别让 NaN 把排序搅乱。
    const modified = Date.parse(value('getlastmodified'))
    return [{
      href,
      name: value('displayname') || decodeURIComponent(href.split('/').pop()),
      size: Number(value('getcontentlength') || 0),
      modifiedAt: Number.isNaN(modified) ? 0 : modified,
    }]
  }).sort((a, b) => b.modifiedAt - a.modifiedAt)
}

async function webdavAction(action) {
  if (!webdav.host || !webdav.username || !webdav.password) {
    Object.assign(webdav, readStorage('funotp-webdav', webdavConfig()))
  }
  if (!webdav.host || !webdav.username || !webdav.password) return emit('message', '请先配置 WebDav', true)
  if (!window.funotp?.webdavBackup) return emit('message', '当前环境不支持 WebDav', true)
  webdavLoading.value = true
  try {
    if (action === 'backup') {
      await window.funotp.webdavBackup(webdavConfig(), props.backupContent())
      emit('message', '已备份到 WebDav')
    } else {
      webdavFiles.value = parseWebdavList(await window.funotp.webdavList(webdavConfig()))
      webdavListDialog.value.showModal()
    }
  } catch (error) {
    emit('message', `WebDav 操作失败：${error.message}`, true)
  } finally {
    webdavLoading.value = false
  }
}

async function restoreWebdav(file) {
  try {
    emit('data-file', 'restore', await window.funotp.webdavRestore(webdavConfig(), file.href))
    webdavListDialog.value.close()
  } catch (error) {
    emit('message', `还原失败：${error.message}`, true)
  }
}

async function deleteWebdav(file) {
  const ok = await props.confirm({
    message: `删除云端备份「${file.name}」？`,
    detail: 'WebDav 上的这个文件会被删掉，本地账号不受影响。',
    confirmText: '删除备份',
    danger: true,
  })
  if (!ok) return
  try {
    await window.funotp.webdavDelete(webdavConfig(), file.href)
    webdavFiles.value = webdavFiles.value.filter(item => item.href !== file.href)
    emit('message', '已删除')
  } catch (error) {
    emit('message', `删除失败：${error.message}`, true)
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="settings-drawer" aria-labelledby="settings-title" @click="closeOnBackdrop" @cancel.prevent="close">
    <header class="settings-header">
      <h2 id="settings-title">设置</h2>
      <button type="button" class="settings-close" aria-label="关闭" @click="close">×</button>
    </header>

    <div class="settings-body">
      <div class="settings-tabs" role="tablist">
        <button
          v-for="tab in [['display', '显示'], ['data', '数据'], ['about', '关于']]" :key="tab[0]"
          type="button" role="tab" :aria-selected="activeTab === tab[0]" :class="{ active: activeTab === tab[0] }" @click="activeTab = tab[0]"
        >
          {{ tab[1] }}
        </button>
      </div>

      <div v-if="activeTab === 'display'" class="settings-pane" role="tabpanel">
        <section class="setting-field">
          <h3>每行卡片数</h3>
          <div class="segmented">
            <label v-for="option in [[0, '自适应'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]" :key="option[0]">
              <input v-model.number="settings.display.columns" type="radio" :value="option[0]" name="columns" />
              <span>{{ option[1] }}</span>
            </label>
          </div>
        </section>

        <div class="settings-divider" />
        <section class="setting-field">
          <h3>验证码</h3>
          <label class="switch-line">
            <input v-model="settings.display.groupDigits" type="checkbox" />
            <span class="switch-control" aria-hidden="true" />
            <span>分组显示（123 456）</span>
          </label>
          <label class="switch-line">
            <input v-model="settings.display.maskCode" type="checkbox" />
            <span class="switch-control" aria-hidden="true" />
            <span>默认打码，防止旁人偷看</span>
          </label>
          <label class="switch-line">
            <input v-model="settings.display.showNext" type="checkbox" />
            <span class="switch-control" aria-hidden="true" />
            <span>最后 5 秒提示下一个验证码</span>
          </label>
        </section>

        <div class="settings-divider" />
        <section class="setting-field">
          <h3>复制后</h3>
          <label class="switch-line">
            <input v-model="settings.copy.outPlugin" type="checkbox" />
            <span class="switch-control" aria-hidden="true" />
            <span>{{ settings.copy.outPlugin ? '自动退出插件（可直接粘贴）' : '留在插件里并提示' }}</span>
          </label>
        </section>

        <div class="settings-divider" />
        <section class="setting-field">
          <h3>键盘</h3>
          <p class="data-help">点一下插件界面把焦点交给它之后，方向键选中卡片、回车复制。</p>
          <label class="switch-line">
            <input v-model="settings.copy.copyOnEnter" type="checkbox" />
            <span class="switch-control" aria-hidden="true" />
            <span>没有选中卡片时，回车直接复制第一个</span>
          </label>
        </section>

        <div class="settings-divider" />
        <section class="setting-field">
          <h3>排序方式</h3>
          <div class="segmented">
            <label v-for="option in [['manual', '手动拖动'], ['name', '按账号名'], ['issuer', '按服务商']]" :key="option[0]">
              <input v-model="settings.display.sort" type="radio" :value="option[0]" name="sort" />
              <span>{{ option[1] }}</span>
            </label>
          </div>
        </section>

        <div class="settings-divider" />
        <section class="setting-field">
          <h3>搜索匹配</h3>
          <div class="checkbox-row">
            <label class="check disabled"><input type="checkbox" checked disabled /><span />账号名</label>
            <label class="check"><input type="checkbox" :checked="settings.search.includes('issuer')" @change="toggleSearch('issuer')" /><span />服务商</label>
            <label class="check"><input type="checkbox" :checked="settings.search.includes('note')" @change="toggleSearch('note')" /><span />备注</label>
          </div>
        </section>

        <div class="settings-divider" />
        <section class="setting-field">
          <h3>导航圆角</h3>
          <input v-model.number="settings.navbar.rounded" class="range" type="range" min="0" max="50" aria-label="导航圆角" :style="{ '--range': settings.navbar.rounded }" />
        </section>
      </div>

      <div v-else-if="activeTab === 'data'" class="settings-pane" role="tabpanel">
        <section class="data-field">
          <h3>本地备份还原</h3>
          <p class="data-help">备份文件含明文密钥，请存放在你信任的地方。</p>
          <div class="button-pair">
            <button type="button" class="data-button warning" @click="emit('export')">备份到电脑</button>
            <button type="button" class="data-button success" @click="choose('restore')">从电脑还原</button>
          </div>
        </section>

        <section class="data-field">
          <div class="data-label"><span>WebDav 备份还原</span><button type="button" class="text-button" @click="openWebdav">配置 WebDav</button></div>
          <div class="button-pair">
            <button type="button" class="data-button warning" :disabled="webdavLoading" @click="webdavAction('backup')">{{ webdavLoading ? '正在处理…' : '备份到 WebDav' }}</button>
            <button type="button" class="data-button success" :disabled="webdavLoading" @click="webdavAction('restore')">从 WebDav 还原</button>
          </div>
        </section>

        <section class="data-field">
          <h3>导入账号</h3>
          <p class="data-help">支持每行一条 otpauth:// 链接的文本文件，重复的账号会自动跳过。</p>
          <label v-if="groups.length" class="input-group">
            <span>导入到分组</span>
            <select v-model="importGroupId">
              <option value="">不分组</option>
              <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>
          <button type="button" class="data-button primary" @click="choose('import')">选择文件导入</button>
        </section>

        <section class="data-field">
          <h3>导出密钥</h3>
          <p class="data-help">导出为 otpauth:// 文本，可被其他验证器读取。<b class="danger-text">文件内是明文密钥。</b></p>
          <button type="button" class="data-button danger" @click="emit('export-uris')">导出 otpauth 链接</button>
        </section>
      </div>

      <div v-else class="settings-pane about-pane" role="tabpanel">
        <p class="about-stat"><b>{{ accountCount }}</b> 个账号 · <b>{{ groups.length }}</b> 个分组</p>
        <h3>密钥随行 · FunOTP</h3>
        <p>本地两步验证码管理器，兼容 Google Authenticator、Microsoft Authenticator、Authy 等使用的 TOTP / HOTP 标准。</p>
        <ul class="about-list">
          <li>验证码全部在本机离线计算，插件自身不会把密钥发给任何第三方服务。</li>
          <li>密钥存在 uTools 的数据库里。<b class="danger-text">若你在 uTools 中开启了数据同步，密钥会随 uTools 账号同步到云端并下发到你的其他设备。</b>介意的话请关闭 uTools 数据同步。</li>
          <li>卸载插件会一并删除数据，请提前备份。</li>
          <li>删除账号前请确认该网站已关闭两步验证，或已保存好恢复码。</li>
        </ul>
      </div>
    </div>

    <input ref="restoreInput" type="file" accept="application/json,.json" hidden @change="readFile('restore', $event)" />
    <input ref="importInput" type="file" accept=".txt,.json,text/plain" hidden @change="readFile('import', $event)" />
  </dialog>

  <dialog ref="webdavDialog" class="sub-modal">
    <form method="dialog" @submit.prevent="saveWebdav">
      <header><h2>WebDav 配置</h2><button type="button" aria-label="关闭" @click="webdavDialog.close()">×</button></header>
      <p class="data-help">备份是<b class="danger-text">明文密钥</b>，只支持 <b>https://</b> 地址，请使用可信的服务器。</p>
      <label><span>服务器</span><input v-model="webdav.host" type="url" pattern="https://.*" placeholder="https://dav.example.com/dav/" required /></label>
      <label><span>用户名</span><input v-model="webdav.username" autocomplete="off" required /></label>
      <label><span>密 码</span><input v-model="webdav.password" type="password" autocomplete="off" required /></label>
      <footer><button type="button" class="button" @click="webdavDialog.close()">取消</button><button type="submit" class="button primary">保存</button></footer>
    </form>
  </dialog>

  <dialog ref="webdavListDialog" class="sub-modal">
    <header><h2>已备份文件</h2><button type="button" aria-label="关闭" @click="webdavListDialog.close()">×</button></header>
    <div v-if="webdavFiles.length" class="webdav-file-list">
      <div v-for="file in webdavFiles" :key="file.href">
        <span>{{ file.name }}</span>
        <small>{{ (file.size / 1024).toFixed(2) }}kb</small>
        <button type="button" @click="restoreWebdav(file)">还原</button>
        <button type="button" class="danger-text" @click="deleteWebdav(file)">删除</button>
      </div>
    </div>
    <div v-else class="webdav-empty">暂无数据</div>
  </dialog>
</template>
