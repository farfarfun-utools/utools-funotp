// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { mount } from '@vue/test-utils'
import { test } from 'vitest'
import AccountCard from '../src/components/AccountCard.vue'
import type { CodeView } from '../src/lib/core'

// 卡片现在只画 composable 算好的 CodeView，自己不碰密钥也不算码（以前每秒的倒计时都会把格式化重跑一遍）。
// 这几条用例钉住那个分工：给什么就画什么，以及点击只在该冒泡的时候冒泡。
const ACCOUNT = { id: 'a', type: 'totp', issuer: 'GitHub', name: 'me@example.com', period: 30, counter: 0, color: '#16b8c7', icon: 'GH' }

function card(props: Record<string, unknown> = {}) {
  const view: CodeView = { code: '123 456', next: '654 321', invalid: false }
  return mount(AccountCard, { props: { account: ACCOUNT, view, now: 10_000, ...props } })
}

test('验证码按给的那份视图画，不自己格式化', () => {
  assert.equal(card().find('.otp-code').text(), '123 456')

  const masked = card({ view: { code: '••• •••', next: '', invalid: false } })
  assert.ok(masked.find('.otp-code').classes().includes('masked'), '打码要用小一号的字距，不然圆点撑破卡片')

  // 密钥坏掉时 code 位置放的是错误文案，不能再按打码处理（文案里也可能有圆点）。
  const broken = card({ view: { code: '密钥无效', next: '', invalid: true } })
  assert.ok(broken.classes().includes('invalid'))
  assert.equal(broken.find('.otp-code').classes().includes('masked'), false)
})

test('TOTP 显示剩余秒数，HOTP 显示计数器', () => {
  // now=10_000 → 10 % 30，还剩 20 秒。
  const totp = card()
  assert.equal(totp.find('.otp-seconds').text(), '20')
  assert.equal(totp.find('.otp-ring').exists(), true)

  const hotp = card({ account: { ...ACCOUNT, type: 'hotp', counter: 7 } })
  assert.equal(hotp.find('.otp-counter').text(), '#7')
  assert.equal(hotp.find('.otp-ring').exists(), false, 'HOTP 不随时间变，画个倒计时圆环只会误导')
  assert.equal(hotp.find('.otp-seconds').exists(), false)
})

test('最后 5 秒才提示下一个码', () => {
  assert.equal(card({ showNext: true }).find('.otp-next').exists(), false, '还剩 20 秒时提示下一个码没意义')

  // now=27_000 → 还剩 3 秒。
  const expiring = card({ showNext: true, now: 27_000 })
  assert.ok(expiring.classes().includes('expiring'))
  assert.match(expiring.find('.otp-next').text(), /654 321/)

  assert.equal(card({ showNext: false, now: 27_000 }).find('.otp-next').exists(), false, '关掉开关就不提示')
})

test('点卡片复制，废纸篓里的卡片点了不复制', async () => {
  const normal = card()
  await normal.trigger('click')
  assert.deepEqual(normal.emitted('copy'), [[ACCOUNT]])

  const trashed = card({ trashView: true })
  await trashed.trigger('click')
  assert.equal(trashed.emitted('copy'), undefined, '废纸篓里的账号点一下就把密钥复制走不合理')
  assert.equal(trashed.attributes('draggable'), 'false', '废纸篓里不参与排序')
})

test('星标和编辑按钮不连带触发复制', async () => {
  const wrapper = card()
  const buttons = wrapper.findAll('.otp-actions button')

  await buttons[0].trigger('click')
  assert.deepEqual(wrapper.emitted('favorite'), [[ACCOUNT]])
  await buttons[1].trigger('click')
  assert.deepEqual(wrapper.emitted('edit'), [[ACCOUNT]])
  // 卡片整体是「点击即复制」，按钮忘了 .stop 的话点星标会顺手把验证码塞进剪贴板。
  assert.equal(wrapper.emitted('copy'), undefined)
})
