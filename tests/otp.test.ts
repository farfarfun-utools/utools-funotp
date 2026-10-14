import assert from 'node:assert/strict'
import { test } from 'vitest'
import { base32Decode, base32Encode, isValidSecret, normalizeSecret } from '../src/lib/base32'
import { counterAt, counterFor, formatCode, generateOtp, remainingSeconds } from '../src/lib/otp'

const encoder = new TextEncoder()
// RFC 4226 / 6238 的测试密钥都是这串 ASCII 重复到所需长度。
const seed = length => base32Encode(encoder.encode('12345678901234567890'.repeat(4).slice(0, length)))
const SHA1_SEED = seed(20)
const SHA256_SEED = seed(32)
const SHA512_SEED = seed(64)

test('base32 编解码可往返，并容忍空格、小写与填充', () => {
  assert.equal(base32Encode(encoder.encode('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.equal(normalizeSecret(' gezd gnbv-gy3t qojq== '), 'GEZDGNBVGY3TQOJQ')
  assert.deepEqual(base32Decode('gezdgnbv'), base32Decode('GEZD GNBV'))
  assert.equal(isValidSecret('GEZDGNBV1'), false, '1 不在 base32 字母表里')
  assert.equal(isValidSecret(''), false)
})

test('HOTP 与 RFC 4226 附录 D 的测试向量一致', async () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  for (const [counter, code] of expected.entries()) {
    assert.equal(await generateOtp({ secret: SHA1_SEED, counter }), code, `counter=${counter}`)
  }
})

test('TOTP 与 RFC 6238 附录 B 的测试向量一致', async () => {
  const cases: Array<[number, string, string, string]> = [
    [59, 'SHA1', SHA1_SEED, '94287082'],
    [59, 'SHA256', SHA256_SEED, '46119246'],
    [59, 'SHA512', SHA512_SEED, '90693936'],
    [1111111109, 'SHA1', SHA1_SEED, '07081804'],
    [1111111111, 'SHA1', SHA1_SEED, '14050471'],
    [1234567890, 'SHA1', SHA1_SEED, '89005924'],
    [1111111109, 'SHA256', SHA256_SEED, '68084774'],
    [2000000000, 'SHA1', SHA1_SEED, '69279037'],
    [2000000000, 'SHA256', SHA256_SEED, '90698825'],
    [20000000000, 'SHA1', SHA1_SEED, '65353130'],
    // 这一条的计数器超过 2^32，用来确认 8 字节计数器没有丢高位。
    [20000000000, 'SHA512', SHA512_SEED, '47863826'],
  ]
  for (const [seconds, algorithm, secret, code] of cases) {
    const counter = counterAt(seconds * 1000, 30)
    assert.equal(await generateOtp({ secret, algorithm, digits: 8, counter }), code, `${algorithm}@${seconds}`)
  }
})

test('counterFor 按账号类型选计数器', async () => {
  const totp = { secret: SHA1_SEED, algorithm: 'SHA1', digits: 8, period: 30, type: 'totp' }
  assert.equal(counterFor(totp, 59_000), 1)
  assert.equal(await generateOtp({ ...totp, counter: counterFor(totp, 59_000) }), '94287082')

  const hotp = { secret: SHA1_SEED, type: 'hotp', digits: 6, counter: 3 }
  assert.equal(counterFor(hotp, 59_000), 3)
  assert.equal(counterFor(hotp, Date.now()), 3, 'HOTP 与时间无关')
  assert.equal(await generateOtp({ ...hotp, counter: counterFor(hotp) }), '969429')

  // 负计数器会让 counterBytes 输出全零，算出来的码跟任何验证器都对不上，这里必须夹到 0。
  assert.equal(counterFor({ secret: SHA1_SEED, type: 'hotp', counter: -5 }), 0)
})

test('Steam 令牌是 5 位专用字母表', async () => {
  const code = await generateOtp({ secret: SHA1_SEED, encoding: 'steam', counter: 1 })
  assert.equal(code.length, 5)
  assert.match(code, /^[23456789BCDFGHJKMNPQRTVWXY]+$/)
})

test('倒计时按周期回绕', () => {
  assert.equal(remainingSeconds(0, 30), 30)
  assert.equal(remainingSeconds(1_000, 30), 29)
  assert.equal(remainingSeconds(29_000, 30), 1)
  assert.equal(remainingSeconds(30_000, 30), 30)
  assert.equal(remainingSeconds(45_000, 60), 15)
})

test('异常参数被夹到合法范围而不是抛错', async () => {
  assert.equal((await generateOtp({ secret: SHA1_SEED, digits: 99, counter: 0 })).length, 10)
  assert.equal((await generateOtp({ secret: SHA1_SEED, digits: 0, counter: 0 })).length, 4)
  assert.equal(counterAt(59_000, 0), counterAt(59_000, 30), '周期为 0 时回落到默认 30 秒')
})

test('验证码按位数分组显示', () => {
  assert.equal(formatCode('123456'), '123 456')
  assert.equal(formatCode('12345678'), '1234 5678')
  assert.equal(formatCode('123456', false), '123456')
  assert.equal(formatCode('2K9FH'), '2K9FH', 'Steam 码不分组')
})

// 密钥导入的 CryptoKey 现在按「算法 + 密钥」缓存，验证缓存不会串味、也不会缓存失败。
test('重复算同一个密钥结果一致，换算法不会复用错的 key', async () => {
  const first = await generateOtp({ secret: SHA1_SEED, counter: 1 })
  const again = await generateOtp({ secret: SHA1_SEED, counter: 1 })
  assert.equal(again, first, '命中缓存后结果必须和第一次一样')

  const sha256 = await generateOtp({ secret: SHA1_SEED, algorithm: 'SHA256', counter: 1, digits: 8 })
  const sha1 = await generateOtp({ secret: SHA1_SEED, algorithm: 'SHA1', counter: 1, digits: 8 })
  assert.notEqual(sha256, sha1, '同一密钥换算法必须重新导入 key')
})

test('无效密钥每次都报错，不会被缓存成永久失败', async () => {
  await assert.rejects(generateOtp({ secret: 'A1B2', counter: 0 }), /A-Z 和 2-7/)
  await assert.rejects(generateOtp({ secret: 'A1B2', counter: 0 }), /A-Z 和 2-7/)
  // 同一轮里换成合法密钥要能立刻算出来。
  assert.equal((await generateOtp({ secret: SHA1_SEED, counter: 0 })).length, 6)
})

test('大写、小写、带空格的同一个密钥算出同一个码', async () => {
  const canonical = await generateOtp({ secret: 'JBSWY3DPEHPK3PXP', counter: 7 })
  assert.equal(await generateOtp({ secret: 'jbswy3dpehpk3pxp', counter: 7 }), canonical)
  assert.equal(await generateOtp({ secret: 'JBSW Y3DP-EHPK 3PXP==', counter: 7 }), canonical)
})
