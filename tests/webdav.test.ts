import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, test } from 'vitest'
import { checkedTarget, request, webdavBase, webdavFileTarget, webdavHeaders, webdavTarget } from '../utools/webdav.js'

// 这三条守卫拦的都是外部输入：服务器给的重定向地址、PROPFIND 列表里的 href、用户填的 host。
// 放过任何一条的后果都是实打实的——把 WebDav 密码发给别人的服务器，或者读写备份目录外的文件。
const CONFIG = { host: 'https://dav.example.com/remote.php/dav', username: 'me', password: 'pw' }

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

// 本地只能起 http，所以这里直接测 request；HTTPS 那道闸在 webdavBase 上，另外测。
function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  return new Promise<string>(resolve => {
    server.on('listening', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`)
    })
  })
}

test('WebDav 服务器地址必须是 HTTPS', () => {
  assert.equal(webdavBase({ host: 'https://dav.example.com' }).href, 'https://dav.example.com/')
  assert.equal(webdavBase(CONFIG).href, 'https://dav.example.com/remote.php/dav/', '缺的那个斜杠要补上，否则最后一段会被当成文件名替换掉')
  assert.throws(() => webdavBase({ host: 'http://dav.example.com' }), /HTTPS/, '明文传的是账号密码和全部密钥')
  assert.throws(() => webdavBase({ host: ' ' }), /请先填写/)
  assert.throws(() => webdavBase({}), /请先填写/)
  assert.throws(() => webdavBase({ host: 'dav.example.com' }), /无法解析/, '不带协议的地址要说清是解析失败，而不是甩一句 Invalid URL')
})

test('备份目录固定挂在配置的地址下面', () => {
  assert.equal(webdavTarget(CONFIG), 'https://dav.example.com/remote.php/dav/FunOTP/')
  assert.equal(webdavTarget(CONFIG, '2026-1-1.json'), 'https://dav.example.com/remote.php/dav/FunOTP/2026-1-1.json')
})

test('服务器返回的文件地址只认备份目录里的', () => {
  // PROPFIND 返回的 href 一般是绝对路径，要能接住。
  assert.equal(
    webdavFileTarget(CONFIG, '/remote.php/dav/FunOTP/2026-1-1.json'),
    'https://dav.example.com/remote.php/dav/FunOTP/2026-1-1.json',
  )
  assert.equal(
    webdavFileTarget(CONFIG, 'https://dav.example.com/remote.php/dav/FunOTP/a.json'),
    'https://dav.example.com/remote.php/dav/FunOTP/a.json',
  )

  const rejected = [
    ['https://evil.example.com/remote.php/dav/FunOTP/a.json', '换个域名就能把备份文件和密码骗走'],
    ['/remote.php/dav/other/a.json', '目录外的文件不该被读写'],
    ['/remote.php/dav/FunOTP/../other/a.json', '上跳会被 URL 归一化成目录外的路径'],
    ['/remote.php/dav/FunOTPevil/a.json', '只比前缀的话这种同名前缀目录能混进来'],
    ['/remote.php/dav/FunOTP/%2e%2e/other/a.json', '转义过的上跳 URL 不归一化，服务器那头却会解码'],
    ['/', '根目录'],
  ]
  for (const [href, reason] of rejected) {
    assert.throws(() => webdavFileTarget(CONFIG, href), /不在已配置的备份目录中/, reason)
  }
})

test('跨域重定向直接拒掉，不跟过去', async () => {
  const other = await serve((_request, response) => response.end('secret'))
  const origin = await serve((_request, response) => {
    response.writeHead(302, { location: `${other}/FunOTP/a.json` })
    response.end()
  })

  // 第一跳没有 origin：以它自己为基准，重定向到别的端口就算跨域。
  await assert.rejects(request(`${origin}/FunOTP/a.json`), /不允许跨域重定向/)
  assert.throws(() => checkedTarget('https://evil.example.com/a', 'https://dav.example.com'), /不允许跨域重定向/)
  assert.equal(checkedTarget('https://dav.example.com/a', 'https://dav.example.com').href, 'https://dav.example.com/a')
  assert.equal(checkedTarget('https://anywhere.example.com/a').href, 'https://anywhere.example.com/a', '第一跳没有可比对的来源')
})

test('同源重定向照常跟随', async () => {
  const origin = await serve((incoming, response) => {
    if (incoming.url === '/old') {
      response.writeHead(302, { location: '/new' })
      return response.end()
    }
    response.end('{"accounts":[]}')
  })

  assert.equal((await request(`${origin}/old`)).body, '{"accounts":[]}')
})

test('重定向次数用完就按原响应处理', async () => {
  const origin = await serve((incoming, response) => {
    response.writeHead(302, { location: '/again' })
    response.end()
  })

  // 不限次数的话服务器一直 302 就能把插件挂在这里。
  await assert.rejects(request(`${origin}/loop`), /^Error: 302 /)
})

test('非 2xx 带上状态码报出来，MKCOL 的 405 不算失败', async () => {
  const origin = await serve((incoming, response) => {
    response.writeHead(incoming.method === 'MKCOL' ? 405 : 404)
    response.end()
  })

  await assert.rejects(request(`${origin}/FunOTP/missing.json`), /404/)
  // 目录已经存在是正常情况，备份不该因为它停下。
  assert.equal((await request(`${origin}/FunOTP/`, { method: 'MKCOL' })).status, 405)
})

test('服务器不响应时按超时失败，而不是一直挂着', async () => {
  const origin = await serve(() => {})
  await assert.rejects(request(`${origin}/FunOTP/`, { timeout: 80 }), /秒超时/)
})

test('认证头是 Basic，额外头能覆盖进去', () => {
  const headers = webdavHeaders(CONFIG, { Depth: '1' })
  assert.equal(headers.Authorization, `Basic ${Buffer.from('me:pw').toString('base64')}`)
  assert.equal(headers.Depth, '1')
})
