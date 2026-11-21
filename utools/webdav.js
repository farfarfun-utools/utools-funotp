// WebDav 的传输和地址守卫。单独拆出来是为了能被测试拿到：
// preload.js 是 uTools 用 Node 加载的 CommonJS，整个文件 require 进来会先碰到
// utools.onPluginEnter，而真正该被测到的恰恰是这里几条守卫——它们拦的是
// 「把 Authorization 头（WebDav 账号密码）送给别的服务器」和「读写备份目录之外的文件」。
const http = require('http')
const https = require('https')

const WEBDAV_DIRECTORY = 'FunOTP'
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const NO_REDIRECT_METHODS = new Set(['PUT', 'DELETE'])

// 重定向跟过去的地址必须同源，否则 Authorization 头会连带密码一起发给新服务器。
// origin 为空表示这是第一跳，还没有需要比对的来源。
function checkedTarget(url, origin) {
  const target = new URL(url)
  if (origin && target.origin !== origin) throw new Error('WebDav 不允许跨域重定向')
  return target
}

function request(url, { method = 'GET', headers = {}, body = '', timeout = 10000, redirects = 3, origin, maxBytes = MAX_RESPONSE_BYTES, deadline } = {}) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = checkedTarget(url, origin)
    } catch (error) {
      return reject(error)
    }
    const expectedOrigin = origin || target.origin
    const totalDeadline = deadline ?? (Date.now() + timeout)
    const remaining = totalDeadline - Date.now()
    if (remaining <= 0) return reject(new Error(`${timeout / 1000}秒超时`))

    const client = target.protocol === 'https:' ? https : http
    let settled = false
    let req
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      const error = new Error(`${timeout / 1000}秒超时`)
      finish(reject, error)
      req?.destroy(error)
    }, remaining)

    req = client.request(target, { method, headers }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects) {
        response.resume()
        if (NO_REDIRECT_METHODS.has(String(method).toUpperCase())) {
          return finish(reject, new Error('WebDav 写入或删除操作不允许重定向'))
        }
        let nextUrl
        try {
          nextUrl = new URL(response.headers.location, target).href
        } catch {
          return finish(reject, new Error('WebDav 重定向地址无效'))
        }
        clearTimeout(timer)
        settled = true
        return resolve(request(nextUrl, {
          method,
          headers,
          body,
          timeout,
          redirects: redirects - 1,
          origin: expectedOrigin,
          maxBytes,
          deadline: totalDeadline,
        }))
      }
      const chunks = []
      let totalBytes = 0
      response.on('data', chunk => {
        totalBytes += chunk.length
        if (totalBytes > maxBytes) {
          const error = new Error(`WebDav 响应体积超过 ${Math.round(maxBytes / (1024 * 1024))} MB 上限`)
          finish(reject, error)
          response.destroy(error)
          req.destroy(error)
          return
        }
        chunks.push(chunk)
      })
      response.on('error', error => finish(reject, error))
      response.on('aborted', () => finish(reject, new Error('WebDav 连接被中断')))
      response.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8')
        // MKCOL 撞上已存在的目录会返回 405，这不算失败。
        if ((response.statusCode >= 200 && response.statusCode < 300) || (method === 'MKCOL' && response.statusCode === 405)) {
          finish(resolve, { status: response.statusCode, body: content })
        } else finish(reject, new Error(`${response.statusCode} ${response.statusMessage || '请求失败'}`))
      })
    })
    req.on('error', error => finish(reject, error))
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
    base = new URL(host)
  } catch {
    throw new Error(`WebDav 服务器地址无法解析：${host}`)
  }
  if (base.protocol !== 'https:') throw new Error('WebDav 服务器必须使用 HTTPS')
  base.search = ''
  base.hash = ''
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return base
}

function webdavTarget(config, file = '') {
  return new URL(`${WEBDAV_DIRECTORY}/${file}`, webdavBase(config)).href
}

// 拿 pathname 原样比不够：%2e%2e 这类转义过的上跳在 URL 里不会被归一化，
// 服务器收到后却会解码成 ..，于是能读到（或删掉）备份目录外的文件。先解码再比，
// 解码失败或出现二次编码、反斜杠一律按失败关门，不回退到原始路径。
function decodedPath(url) {
  const raw = url.pathname
  if (raw.includes('\\') || /%5c/i.test(raw) || /%25/i.test(raw)) {
    throw new Error('WebDav 文件地址不在已配置的备份目录中')
  }
  let decoded
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw new Error('WebDav 文件地址不在已配置的备份目录中')
  }
  if (decoded.includes('\\') || /%5c/i.test(decoded)) {
    throw new Error('WebDav 文件地址不在已配置的备份目录中')
  }
  return decoded
}

// href 来自服务器返回的 PROPFIND 列表，属于外部输入：同源、在备份目录内、不含上跳，缺一不可。
function webdavFileTarget(config, href) {
  const base = webdavBase(config)
  const directory = new URL(`${WEBDAV_DIRECTORY}/`, base)
  let target
  try {
    target = new URL(href, base)
  } catch {
    throw new Error('WebDav 文件地址不在已配置的备份目录中')
  }
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

module.exports = { WEBDAV_DIRECTORY, MAX_RESPONSE_BYTES, request, checkedTarget, webdavBase, webdavTarget, webdavFileTarget, webdavHeaders }
