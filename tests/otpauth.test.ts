import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildOtpauthUri, parseMigrationUri, parseOtpauthText, parseOtpauthUri } from '../src/lib/otpauth'

test('解析标准 otpauth 链接', () => {
  const account = parseOtpauthUri('otpauth://totp/GitHub:tau-niu?secret=BZJZM4KT4Z7JHKOC&issuer=GitHub')
  assert.equal(account.type, 'totp')
  assert.equal(account.issuer, 'GitHub')
  assert.equal(account.name, 'tau-niu')
  assert.equal(account.secret, 'BZJZM4KT4Z7JHKOC')
  assert.equal(account.algorithm, 'SHA1')
  assert.equal(account.digits, 6)
  assert.equal(account.period, 30)
})

test('标签里的账号名会被 URL 解码', () => {
  const account = parseOtpauthUri('otpauth://totp/Google:me%40gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google')
  assert.equal(account.name, 'me@gmail.com')
})

test('小写密钥统一转成大写', () => {
  assert.equal(parseOtpauthUri('otpauth://totp/a:b?secret=jbswy3dpehpk3pxp').secret, 'JBSWY3DPEHPK3PXP')
})

test('标签写成 "issuer:" 时账号名留空，不重复填服务名', () => {
  const account = parseOtpauthUri('otpauth://totp/openai:?secret=JBSWY3DPEHPK3PXP&issuer=openai')
  assert.equal(account.issuer, 'openai')
  assert.equal(account.name, '')
})

test('读取非默认参数', () => {
  const account = parseOtpauthUri('otpauth://hotp/Acme:me?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&counter=42')
  assert.equal(account.type, 'hotp')
  assert.equal(account.algorithm, 'SHA256')
  assert.equal(account.digits, 8)
  assert.equal(account.counter, 42)
})

test('拒绝无效链接', () => {
  assert.throws(() => parseOtpauthUri('https://example.com'), /不是 otpauth/)
  assert.throws(() => parseOtpauthUri('otpauth://totp/a:b?secret='), /密钥无效/)
  assert.throws(() => parseOtpauthUri('otpauth://totp/a:b?secret=NOT-BASE32-!!'), /密钥无效/)
})

test('构建的链接能被原样解析回来', () => {
  const original = {
    type: 'totp', issuer: '有赞', name: 'me@example.com', secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA512', digits: 8, period: 60, counter: 0, encoding: 'standard',
  }
  const parsed = parseOtpauthUri(buildOtpauthUri(original))
  assert.deepEqual(parsed, original)
})

test('Steam 与 HOTP 的往返也不丢参数', () => {
  const steam = parseOtpauthUri(buildOtpauthUri({ type: 'totp', issuer: 'Steam', name: 'me', secret: 'JBSWY3DPEHPK3PXP', encoding: 'steam' }))
  assert.equal(steam.encoding, 'steam')

  const hotp = parseOtpauthUri(buildOtpauthUri({ type: 'hotp', issuer: 'Acme', name: 'me', secret: 'JBSWY3DPEHPK3PXP', counter: 7 }))
  assert.equal(hotp.type, 'hotp')
  assert.equal(hotp.counter, 7)
})

test('从多行文本里捞出所有链接，并跳过坏行', () => {
  const text = [
    '# 我的备份',
    'otpauth://totp/GitHub:a?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
    '这里是一行说明文字',
    'otpauth://totp/坏的?secret=###',
    'otpauth://totp/PyPI:b?secret=AITZ4U3D3OCZGEYSF4UXJPQTIOV62V2U&issuer=PyPI',
  ].join('\n')
  const { accounts, errors } = parseOtpauthText(text)
  assert.equal(accounts.length, 2)
  assert.equal(errors.length, 1)
  assert.deepEqual(accounts.map(account => account.issuer), ['GitHub', 'PyPI'])
})

test('解析 Google Authenticator 的迁移二维码', () => {
  // 用 protobuf 手工拼一条：secret=JBSWY3DPEHPK3PXP、name=me、issuer=Acme、TOTP。
  const secret = Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef])
  const entry = [
    0x0a, secret.length, ...secret,
    0x12, 2, 0x6d, 0x65,
    0x1a, 4, 0x41, 0x63, 0x6d, 0x65,
    0x20, 1, // algorithm = SHA1
    0x28, 1, // digits = six
    0x30, 2, // type = totp
  ]
  const payload = Uint8Array.from([0x0a, entry.length, ...entry, 0x10, 1])
  const data = Buffer.from(payload).toString('base64')

  const accounts = parseMigrationUri(`otpauth-migration://offline?data=${encodeURIComponent(data)}`)
  assert.equal(accounts.length, 1)
  assert.deepEqual(accounts[0], {
    type: 'totp', issuer: 'Acme', name: 'me', secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1', digits: 6, period: 30, counter: 0, encoding: 'standard',
  })
})

test('迁移链接也能混在普通文本里被解析', () => {
  assert.throws(() => parseMigrationUri('otpauth-migration://offline?nodata=1'), /缺少 data/)
  assert.throws(() => parseMigrationUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP'), /不是 otpauth-migration/)
})

test('迁移链接里畸形 URL、坏 base64、截断定长字段与超大计数器都会被安全处理', () => {
  assert.throws(() => parseMigrationUri('otpauth-migration://[::1'), /格式不正确/)
  assert.throws(() => parseMigrationUri('otpauth-migration://offline?data=***not-base64***'), /已损坏/)

  // wire=5 (32-bit fixed) 仅剩 2 字节、wire=1 (64-bit fixed) 仅剩 4 字节都必须按损坏拒绝。
  const badFixed32 = Buffer.from([0x0d, 0x01, 0x02]).toString('base64')
  const badFixed64 = Buffer.from([0x09, 0x01, 0x02, 0x03, 0x04]).toString('base64')
  assert.throws(() => parseMigrationUri(`otpauth-migration://offline?data=${encodeURIComponent(badFixed32)}`), /已损坏/)
  assert.throws(() => parseMigrationUri(`otpauth-migration://offline?data=${encodeURIComponent(badFixed64)}`), /已损坏/)

  // 超过 MAX_SAFE_INTEGER 的 64 位 HOTP counter 应夹到安全整数上限。
  const secret = Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f])
  const hugeCounter = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]
  const entry = [
    0x0a, secret.length, ...secret,
    0x12, 2, 0x6d, 0x65,
    0x30, 1, // type = hotp
    0x38, ...hugeCounter, // field 7 = counter
  ]
  const payload = Uint8Array.from([0x0a, entry.length, ...entry])
  const data = Buffer.from(payload).toString('base64')
  const accounts = parseMigrationUri(`otpauth-migration://offline?data=${encodeURIComponent(data)}`)
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].counter, Number.MAX_SAFE_INTEGER)

  // otpauth:// 小数 counter 也要截断为整数。
  assert.equal(parseOtpauthUri('otpauth://hotp/Acme:me?secret=JBSWY3DPEHPK3PXP&counter=7.9').counter, 7)
})
