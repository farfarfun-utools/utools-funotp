// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { mount } from '@vue/test-utils'
import { test } from 'vitest'
import ConfirmDialog from '../src/components/ConfirmDialog.vue'
import type { ConfirmOptions } from '../src/lib/core'

// 删账号、清废纸篓、导出明文密钥、删云端备份——四条不可撤销的操作全 await 在这个框的 promise 上。
// 任何一条出口忘了结算，调用方就永远卡在那儿（点了删除没反应，也没有错误提示），所以每条出口都测。
function open() {
  const wrapper = mount(ConfirmDialog, { attachTo: document.body })
  const vm = wrapper.vm as unknown as { ask: (options: ConfirmOptions) => Promise<boolean> }
  return { wrapper, ask: (message = '删掉？') => vm.ask({ message }) }
}

function button(wrapper: ReturnType<typeof open>['wrapper'], text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text)
  assert.ok(found, `找不到按钮「${text}」`)
  return found
}

test('点确定给 true，点取消给 false', async () => {
  const { wrapper, ask } = open()

  const first = ask()
  assert.equal(wrapper.find('dialog').element.open, true, '问了就得把框打开')
  await button(wrapper, '确定').trigger('click')
  assert.equal(await first, true)
  assert.equal(wrapper.find('dialog').element.open, false, '结算完要关掉，否则下一次 showModal 会抛')

  const second = ask()
  await button(wrapper, '取消').trigger('click')
  assert.equal(await second, false)
})

test('按 Esc 关掉等于取消', async () => {
  const { wrapper, ask } = open()
  const answer = ask()

  // Esc 由浏览器直接关闭 <dialog> 并发 cancel/close，组件只能靠这两个事件收尾。
  wrapper.find('dialog').element.close()
  assert.equal(await answer, false)
})

test('文案和危险样式按调用方给的来', async () => {
  const wrapper = mount(ConfirmDialog, { attachTo: document.body })
  const vm = wrapper.vm as unknown as { ask: (options: ConfirmOptions) => Promise<boolean> }

  const answer = vm.ask({ message: '删除账号？', detail: '密钥删了找不回', confirmText: '永久删除', danger: true })
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.find('h2').text(), '删除账号？')
  assert.match(wrapper.text(), /密钥删了找不回/)
  assert.ok(wrapper.find('button.primary').classes().includes('danger'), '不可撤销的操作要标红')

  await button(wrapper, '永久删除').trigger('click')
  assert.equal(await answer, true)

  // 下一次问的是普通问题，上一次的危险样式和小字不能留着。
  const plain = vm.ask({ message: '清空废纸篓？' })
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.findAll('p').length, 0, '没给 detail 就不该还显示上一条的小字')
  assert.equal(wrapper.find('button.primary').classes().includes('danger'), false)
  assert.equal(button(wrapper, '确定').exists(), true, 'confirmText 没给要回到默认值')
  await button(wrapper, '确定').trigger('click')
  await plain
})

test('没结算就被再问一次，前一次按取消结掉', async () => {
  const { wrapper, ask } = open()

  const abandoned = ask('第一个问题')
  const current = ask('第二个问题')
  assert.equal(await abandoned, false, '挂着不结算的话第一个调用方会一直 await')

  await wrapper.vm.$nextTick()
  assert.equal(wrapper.find('h2').text(), '第二个问题')
  await button(wrapper, '确定').trigger('click')
  assert.equal(await current, true, '顶上来的那次还要能正常回答')
})
