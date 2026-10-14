<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { COLORS, colorFor, initials, safeColor } from '../lib/core'
import type { Group } from '../lib/core'
import { formatCode, generateOtp } from '../lib/otp'
import { parseOtpauthText } from '../lib/otpauth'
import { decodeQrImage, readClipboardImage } from '../lib/qr'

const props = defineProps({
  groups: { type: Array as PropType<Group[]>, default: () => [] },
  defaultGroupId: { type: String, default: '' },
})
const emit = defineEmits(['save', 'import', 'message'])

const dialog = ref(null)
const secretField = ref(null)
const imageInput = ref(null)
const editing = ref(false)
const mode = ref('scan')
const uriText = ref('')
const busy = ref('')
const error = ref('')
const preview = ref('')
const showSecret = ref(false)

const draft = reactive(emptyDraft())

function emptyDraft() {
  return {
    id: '',
    type: 'totp',
    issuer: '',
    name: '',
    secret: '',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    counter: 0,
    encoding: 'standard',
    groupIds: [],
    color: COLORS[0],
    icon: '',
    note: '',
  }
}

const avatarText = computed(() => draft.icon.trim() || initials(draft.issuer || draft.name))
const canSave = computed(() => Boolean(draft.secret.trim()) && Boolean((draft.issuer || draft.name).trim()))

function open(account = null) {
  Object.assign(draft, emptyDraft(), account || {})
  draft.groupIds = [...(account?.groupIds || (props.defaultGroupId ? [props.defaultGroupId] : []))]
  editing.value = Boolean(account?.id)
  // 从链接/扫码预填过来的草稿已经有密钥了，直接进表单，不必再选一次方式。
  mode.value = editing.value || draft.secret ? 'manual' : 'scan'
  uriText.value = ''
  error.value = ''
  busy.value = ''
  showSecret.value = !editing.value
  if (!dialog.value.open) dialog.value.showModal()
  nextTick(() => { if (mode.value === 'manual') secretField.value?.focus() })
}

function close() {
  dialog.value?.close()
}

// 密钥填对了就能立刻看到验证码，比保存后再回来看省事，也顺手验证了密钥。
// 快速输入时会有多个 generateOtp 同时在算，WebCrypto 不保证先发先回（命中密钥缓存的那次更快），
// 所以用序号认领结果：只有最后一次输入算出来的码才能写进界面。
let previewToken = 0

watch(() => [draft.secret, draft.algorithm, draft.digits, draft.encoding, draft.type, draft.counter], async () => {
  const token = (previewToken += 1)
  error.value = ''
  if (!draft.secret.trim()) return void (preview.value = '')
  try {
    const counter = draft.type === 'hotp' ? Number(draft.counter) || 0 : Math.floor(Date.now() / 1000 / (Number(draft.period) || 30))
    const code = formatCode(await generateOtp({ ...draft, counter }))
    if (token === previewToken) preview.value = code
  } catch (issue) {
    if (token !== previewToken) return
    preview.value = ''
    error.value = issue.message
  }
})

function applyParsed(list) {
  if (list.length === 1) {
    const [parsed] = list
    Object.assign(draft, parsed, { color: colorFor(parsed.issuer || parsed.name) })
    mode.value = 'manual'
    nextTick(() => secretField.value?.focus())
    return
  }
  emit('import', list)
  close()
}

function parseText(text, source) {
  const { accounts, errors } = parseOtpauthText(text)
  if (!accounts.length) {
    error.value = errors[0] || `${source}里没有找到 otpauth:// 链接`
    return
  }
  error.value = ''
  applyParsed(accounts)
}

async function scanImage(source, label) {
  busy.value = label
  error.value = ''
  try {
    parseText(await decodeQrImage(source), '二维码')
  } catch (issue) {
    error.value = issue.message
  } finally {
    busy.value = ''
  }
}

function captureScreen() {
  if (!window.utools?.screenCapture) return void (error.value = '当前环境不支持截屏，请改用「选择图片」')
  // 截屏面板需要插件先让出前台，回调里再把窗口拉回来。
  window.utools.screenCapture(image => {
    if (image) scanImage(image, '正在识别截屏…')
  })
}

async function pickImage() {
  let source
  try {
    source = window.funotp?.chooseImageFile?.()
  } catch (issue) {
    return void (error.value = issue.message)
  }
  if (source) return scanImage(source, '正在识别图片…')
  // null = 用户取消；undefined = 没有桥（浏览器预览），回落到隐藏的 file input。
  if (source === null) return
  imageInput.value?.click()
}

async function readImageInput(event) {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => scanImage(reader.result, '正在识别图片…')
  reader.onerror = () => { error.value = '图片读取失败' }
  reader.readAsDataURL(file)
}

async function pasteImage() {
  try {
    await scanImage(await readClipboardImage(), '正在识别剪贴板…')
  } catch (issue) {
    error.value = issue.message
  }
}

function toggleGroup(groupId) {
  const index = draft.groupIds.indexOf(groupId)
  if (index >= 0) draft.groupIds.splice(index, 1)
  else draft.groupIds.push(groupId)
}

function submit() {
  if (!canSave.value) {
    error.value = draft.secret.trim() ? '请至少填写服务商或账号名' : '请填写密钥'
    return
  }
  if (error.value) return
  emit('save', { ...draft, color: safeColor(draft.color), icon: draft.icon.trim() })
  close()
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="otp-dialog" aria-labelledby="account-dialog-title" @cancel.prevent="close">
    <form @submit.prevent="submit">
      <header class="otp-dialog-header">
        <span class="otp-dialog-avatar" :style="{ backgroundColor: safeColor(draft.color) }">{{ avatarText }}</span>
        <div>
          <h2 id="account-dialog-title">{{ editing ? '编辑账号' : '添加账号' }}</h2>
          <p>验证码在本机离线计算，密钥只存在 uTools 数据库里</p>
        </div>
        <button type="button" class="dialog-close" aria-label="关闭" @click="close">×</button>
      </header>

      <div v-if="!editing" class="mode-tabs" role="tablist">
        <button
          v-for="tab in [['scan', '扫码识别'], ['uri', '粘贴链接'], ['manual', '手动输入']]" :key="tab[0]"
          type="button" role="tab" :aria-selected="mode === tab[0]" :class="{ active: mode === tab[0] }" @click="mode = tab[0]"
        >
          {{ tab[1] }}
        </button>
      </div>

      <div class="otp-dialog-body">
        <section v-if="mode === 'scan'" class="scan-pane">
          <div class="scan-actions">
            <!-- 用内联 SVG 而不是 emoji：emoji 在部分系统上会缺字形显示成方框。 -->
            <button type="button" class="scan-button" :disabled="Boolean(busy)" @click="captureScreen">
              <svg class="scan-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                <rect x="8" y="8" width="8" height="8" rx="1" />
              </svg>
              <b>截屏识别</b>
              <small>框选屏幕上的二维码</small>
            </button>
            <button type="button" class="scan-button" :disabled="Boolean(busy)" @click="pickImage">
              <svg class="scan-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="8.5" cy="9.5" r="1.5" />
                <path d="m4 17 4.5-4.5a1.5 1.5 0 0 1 2.1 0L15 17M14 15l1.6-1.6a1.5 1.5 0 0 1 2.1 0L20 15.7" />
              </svg>
              <b>选择图片</b>
              <small>从本地图片文件识别</small>
            </button>
            <button type="button" class="scan-button" :disabled="Boolean(busy)" @click="pasteImage">
              <svg class="scan-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
              </svg>
              <b>剪贴板</b>
              <small>识别已复制的截图</small>
            </button>
          </div>
          <p class="scan-hint">
            支持普通两步验证二维码，以及 Google Authenticator「导出账号」生成的迁移二维码（一次可导入多个账号）。
          </p>
        </section>

        <section v-else-if="mode === 'uri'" class="uri-pane">
          <label>
            <span>otpauth 链接</span>
            <textarea
              v-model="uriText"
              rows="5"
              spellcheck="false"
              placeholder="otpauth://totp/GitHub:me?secret=XXXX&issuer=GitHub&#10;可一次粘贴多行，也支持 otpauth-migration:// 链接"
            />
          </label>
          <button type="button" class="button primary block" :disabled="!uriText.trim()" @click="parseText(uriText, '文本')">解析链接</button>
        </section>

        <section v-else class="manual-pane">
          <label class="secret-label">
            <span>密钥 <small>(Base32，网站上标注为 Secret Key)</small></span>
            <span class="secret-input">
              <input
                ref="secretField"
                v-model="draft.secret"
                :type="showSecret ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                placeholder="例如 JBSWY3DPEHPK3PXP"
              />
              <button type="button" :title="showSecret ? '隐藏密钥' : '显示密钥'" @click="showSecret = !showSecret">
                {{ showSecret ? '隐藏' : '显示' }}
              </button>
            </span>
          </label>

          <div class="form-row">
            <label><span>服务商</span><input v-model="draft.issuer" placeholder="例如 GitHub" /></label>
            <label><span>账号名</span><input v-model="draft.name" placeholder="例如 me@example.com" /></label>
          </div>

          <div v-if="preview" class="preview-line">
            <span>当前验证码</span>
            <b>{{ preview }}</b>
          </div>

          <div v-if="groups.length" class="group-picker">
            <span>分组</span>
            <div>
              <label v-for="group in groups" :key="group.id" class="chip">
                <input type="checkbox" :checked="draft.groupIds.includes(group.id)" @change="toggleGroup(group.id)" />
                <span>{{ group.name }}</span>
              </label>
            </div>
          </div>

          <div class="color-picker">
            <span>颜色</span>
            <div>
              <button
                v-for="color in COLORS"
                :key="color"
                type="button"
                class="swatch"
                :class="{ active: safeColor(draft.color).toLowerCase() === color }"
                :style="{ backgroundColor: color }"
                :aria-label="`使用颜色 ${color}`"
                @click="draft.color = color"
              />
              <input v-model="draft.icon" class="icon-input" maxlength="4" placeholder="图标字" aria-label="图标文字" />
            </div>
          </div>

          <details class="advanced">
            <summary>高级设置<small>（默认值适用于绝大多数网站）</small></summary>
            <div class="form-row">
              <label>
                <span>类型</span>
                <select v-model="draft.type"><option value="totp">TOTP（按时间）</option><option value="hotp">HOTP（按次数）</option></select>
              </label>
              <label>
                <span>算法</span>
                <select v-model="draft.algorithm"><option>SHA1</option><option>SHA256</option><option>SHA512</option></select>
              </label>
            </div>
            <div class="form-row">
              <label><span>位数</span><input v-model.number="draft.digits" type="number" min="4" max="10" /></label>
              <label v-if="draft.type === 'totp'"><span>周期（秒）</span><input v-model.number="draft.period" type="number" min="1" max="3600" /></label>
              <label v-else><span>计数器</span><input v-model.number="draft.counter" type="number" min="0" /></label>
            </div>
            <label class="check-line">
              <input v-model="draft.encoding" type="checkbox" true-value="steam" false-value="standard" />
              <span>Steam 令牌（5 位专用字母表）</span>
            </label>
            <label><span>备注</span><input v-model="draft.note" placeholder="选填，可用于搜索" /></label>
          </details>
        </section>

        <p class="form-error" role="alert">{{ busy || error }}</p>
      </div>

      <footer class="otp-dialog-footer">
        <button type="button" class="button" @click="close">取消</button>
        <button v-if="mode === 'manual'" type="submit" class="button primary" :disabled="!canSave">保存</button>
      </footer>
    </form>
    <input ref="imageInput" type="file" accept="image/*" hidden @change="readImageInput" />
  </dialog>
</template>
