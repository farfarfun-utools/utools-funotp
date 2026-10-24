const fs = require('fs')
const path = require('path')
const { request, webdavFileTarget, webdavHeaders, webdavTarget } = require('./webdav.js')

// 插件可能在 Vue 挂载之前就收到 onPluginEnter，先攒着，等界面注册好再回放。
const enterQueue = []
let enterHandler = null

utools.onPluginEnter(action => {
  if (enterHandler) enterHandler(action)
  else enterQueue.push(action)
})

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

// fs 抛出来的 EACCES / ENOSPC 对用户没有意义。不转换的话这些错误会一路穿过
// window.funotp 抛进渲染层，而备份这条路最糟的失败就是「什么都没提示」。
const FS_REASONS = {
  EACCES: '没有访问权限',
  EPERM: '没有操作权限',
  ENOSPC: '磁盘空间不足',
  EROFS: '目标磁盘是只读的',
  ENOENT: '路径不存在',
  EISDIR: '目标是一个文件夹',
  EBUSY: '文件正被其他程序占用',
  EMFILE: '系统打开的文件过多',
}

function fsError(action, error) {
  return new Error(`${action}：${FS_REASONS[error?.code] || error?.message || '未知错误'}`)
}

window.funotp = {
  onEnter(callback) {
    enterHandler = callback
    while (enterQueue.length) callback(enterQueue.shift())
  },
  // 返回 false 表示用户取消，界面据此不提示「已导出」，也不能回落到浏览器下载。
  saveBackup(content, defaultName) {
    const destination = utools.showSaveDialog({
      title: '导出密钥随行 FunOTP 数据',
      defaultPath: defaultName,
      filters: [{ name: defaultName.endsWith('.json') ? 'JSON' : '文本', extensions: [defaultName.split('.').pop()] }],
    })
    if (!destination) return false
    try {
      fs.writeFileSync(destination, content, 'utf8')
    } catch (error) {
      throw fsError('无法写入备份文件', error)
    }
    return true
  },
  chooseTextFile(extensions) {
    const result = utools.showOpenDialog({ properties: ['openFile'], filters: [{ name: '数据文件', extensions }] })
    if (!result?.[0]) return null
    try {
      return fs.readFileSync(path.resolve(result[0]), 'utf8')
    } catch (error) {
      throw fsError('无法读取所选文件', error)
    }
  },
  // 读成 data URL，渲染层才能直接丢给 <img> 交给二维码解码。
  chooseImageFile() {
    const result = utools.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    })
    if (!result?.[0]) return null
    const file = path.resolve(result[0])
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()] || 'image/png'
    try {
      return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`
    } catch (error) {
      throw fsError('无法读取所选图片', error)
    }
  },
  async webdavBackup(config, content) {
    await request(webdavTarget(config), { method: 'MKCOL', headers: webdavHeaders(config) })
    const now = new Date()
    const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].join('-')
    await request(webdavTarget(config, `${stamp}.json`), {
      method: 'PUT',
      headers: webdavHeaders(config, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(content) }),
      body: content,
    })
  },
  async webdavList(config) {
    const xml = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'
    return (await request(webdavTarget(config), {
      method: 'PROPFIND',
      headers: webdavHeaders(config, { Depth: '1', 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(xml) }),
      body: xml,
    })).body
  },
  async webdavRestore(config, href) {
    return (await request(webdavFileTarget(config, href), { headers: webdavHeaders(config) })).body
  },
  async webdavDelete(config, href) {
    await request(webdavFileTarget(config, href), { method: 'DELETE', headers: webdavHeaders(config) })
  },
}
