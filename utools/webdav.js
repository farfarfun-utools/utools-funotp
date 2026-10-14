// WebDav 的传输和地址守卫。单独拆出来是为了能被测试拿到：
// preload.js 是 uTools 用 Node 加载的 CommonJS，整个文件 require 进来会先碰到
// utools.onPluginEnter，而真正该被测到的恰恰是这里几条守卫——它们拦的是
// 「把 Authorization 头（WebDav 账号密码）送给别的服务器」和「读写备份目录之外的文件」。
const http = require('http')
const https = require('https')

const WEBDAV_DIRECTORY = 'FunOTP'

// 重定向跟过去的地址必须同源，否则 Authorization 头会连带密码一起发给新服务器。
// origin 为空表示这是第一跳，还没有需要比对的来源。
function checkedTarget(url, origin) {
  const target = new URL(url)
  if (origin && target.origin !== origin) throw new Error('WebDav 不允许跨域重定向')
  return target
}

function request(url, { method = 'GET', headers = {}, body = '', timeout = 10000, redirects = 3, origin } = {}) {
  return new Promise((resolve, reject) => {
    const target = checkedTarget(url, origin)
    const expectedOrigin = origin || target.origin
    const client = target.protocol === 'https:' ? https : http
    const req = client.request(target, { method, headers }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects) {
        response.resume()
        return resolve(request(new URL(response.headers.location, target).href, { method, headers, body, timeout, redirects: redirects - 1, origin: expectedOrigin }))
      }
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8')
        // MKCOL 撞上已存在的目录会返回 405，这不算失败。
        if ((response.statusCode >= 200 && response.statusCode < 300) || (method === 'MKCOL' && response.statusCode === 405)) {
          resolve({ status: response.statusCode, body: content })
        } else reject(new Error(`${response.statusCode} ${response.statusMessage || '请求失败'}`))
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error(`${timeout / 1000}秒超时`)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// 地址没填或填错时 new URL 抛的是 "Invalid URL"，这句话会原样进到界面的提示条里。
function webdavBase(config) {
  const host = String(config?.host || '').trim()
  if (!host) throw new Error('请先填写 WebDav 服务器地址')
  let base
  try {
    base = new URL(host.endsWith('/') ? host : `${host}/`)
  } catch {
    throw new Error(`WebDav 服务器地址无法解析：${host}`)
  }
  if (base.protocol !== 'https:') throw new Error('WebDav 服务器必须使用 HTTPS')
  return base
}

function webdavTarget(config, file = '') {
  return new URL(`${WEBDAV_DIRECTORY}/${file}`, webdavBase(config)).href
}

// 拿 pathname 原样比不够：%2e%2e 这类转义过的上跳在 URL 里不会被归一化，
// 服务器收到后却会解码成 ..，于是能读到（或删掉）备份目录外的文件。先解码再比。
function decodedPath(url) {
  try {
    return decodeURIComponent(url.pathname)
  } catch {
    return url.pathname
  }
}

// href 来自服务器返回的 PROPFIND 列表，属于外部输入：同源、在备份目录内、不含上跳，缺一不可。
function webdavFileTarget(config, href) {
  const base = webdavBase(config)
  const directory = new URL(`${WEBDAV_DIRECTORY}/`, base)
  const target = new URL(href, base)
  const targetPath = decodedPath(target)
  const outside = target.origin !== base.origin
    || !targetPath.startsWith(decodedPath(directory))
    || targetPath.split('/').includes('..')
  if (outside) throw new Error('WebDav 文件地址不在已配置的备份目录中')
  return target.href
}

/**
 * @param {{ username: string, password: string }} config
 * @param {Record<string, string | number>} [extra]
 * @returns {Record<string, string | number>}
 */
function webdavHeaders(config, extra = {}) {
  return { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`, ...extra }
}

module.exports = { WEBDAV_DIRECTORY, request, checkedTarget, webdavBase, webdavTarget, webdavFileTarget, webdavHeaders }
