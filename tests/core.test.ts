import assert from 'node:assert/strict'
import { test } from 'vitest'
import { COLORS, accountMatches, createId, normalizeGroupIds, safeColor } from '../src/lib/core'
import { base32Decode, base32Encode, isValidSecret, normalizeSecret } from '../src/lib/base32'

test('safeColor 挡掉非颜色字符串，避免把任意内容塞进 style', () => {
  assert.equal(safeColor('#16b8c7'), '#16b8c7')
  assert.equal(safeColor('#ABC'), '#ABC')
  assert.equal(safeColor('rgba(1, 2, 3, .5)'), 'rgba(1, 2, 3, .5)')
  // 下面这些都应该回落到默认色，而不是原样进 CSS 变量。
  for (const bad of ['red; background: url(x)', 'url(javascript:alert(1))', 'var(--x)', '', null, {}]) {
    assert.equal(safeColor(bad), COLORS[0], `${JSON.stringify(bad)} 不该被当成合法颜色`)
  }
})

test('accountMatches 只在指定字段里找，且忽略大小写', () => {
  const account = { name: 'Me@Example', issuer: 'GitHub', note: '工作用' }
  assert.equal(accountMatches(account, ''), true, '空关键字匹配所有账号')
  assert.equal(accountMatches(account, '  '), true)
  assert.equal(accountMatches(account, 'github'), true)
  assert.equal(accountMatches(account, 'EXAMPLE'), true)
  assert.equal(accountMatches(account, '工作'), true)
  assert.equal(accountMatches(account, 'gitlab'), false)
  // 关掉备注搜索后，只在备注里出现的词就搜不到了。
  assert.equal(accountMatches(account, '工作', ['name', 'issuer']), false)
})

test('normalizeGroupIds 去掉空值和重复项', () => {
  assert.deepEqual(normalizeGroupIds(['g1', 'g1', '', 'g2', null, 3]), ['g1', 'g2'])
  assert.deepEqual(normalizeGroupIds(null), [])
  assert.deepEqual(normalizeGroupIds('g1'), [], '不是数组就当没有分组')
})

test('createId 连续生成也不重复', () => {
  const ids = Array.from({ length: 200 }, () => createId('acc'))
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(id => id.startsWith('acc-')))
})

test('normalizeSecret 容忍用户从网页上抄来的格式', () => {
  assert.equal(normalizeSecret('jbsw y3dp-ehpk 3pxp'), 'JBSWY3DPEHPK3PXP')
  assert.equal(normalizeSecret('JBSWY3DP===='), 'JBSWY3DP')
  assert.equal(normalizeSecret(null), '')
})

test('base32Decode 对空、非法字符与过短输入给出可读报错', () => {
  assert.throws(() => base32Decode(''), /请输入密钥/)
  assert.throws(() => base32Decode('   '), /请输入密钥/)
  assert.throws(() => base32Decode('ABC1'), /A-Z 和 2-7/, '1 和 0 不在 Base32 字母表里')
  assert.throws(() => base32Decode('AB!CD'), /A-Z 和 2-7/)
  // 单个字符只有 5 bit，凑不满一个字节。
  assert.throws(() => base32Decode('A'), /太短/)
})

test('isValidSecret 与 base32Decode 的判断一致', () => {
  assert.equal(isValidSecret('JBSWY3DPEHPK3PXP'), true)
  assert.equal(isValidSecret('jbswy3dp'), true)
  assert.equal(isValidSecret('A'), false)
  assert.equal(isValidSecret('A1B2'), false)
  assert.equal(isValidSecret(undefined), false)
})

test('base32 编码在字节数不是 5 的倍数时也能往返', () => {
  for (let length = 1; length <= 11; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff)
    assert.deepEqual([...base32Decode(base32Encode(bytes))], [...bytes], `${length} 字节往返失败`)
  }
})
