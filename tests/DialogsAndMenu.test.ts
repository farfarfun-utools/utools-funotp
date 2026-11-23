// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import ContextMenu from '../src/components/ContextMenu.vue'
import GroupDialog from '../src/components/GroupDialog.vue'
import QrDialog from '../src/components/QrDialog.vue'
import * as qrModule from '../src/lib/qr'

describe('GroupDialog inline rename', () => {
  test('点击重命名后自动聚焦输入框，按 Esc 只取消重命名不关闭弹窗', async () => {
    const wrapper = mount(GroupDialog, {
      attachTo: document.body,
      props: {
        groups: [{ id: 'g1', name: '工作' }],
        groupCount: () => 2,
      },
    })
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await nextTick()

    await wrapper.find('button[title="重命名"]').trigger('click')
    await nextTick()

    const renameInput = wrapper.find('.group-rename')
    assert.ok(renameInput.exists())
    assert.equal(document.activeElement, renameInput.element)

    await renameInput.trigger('keydown.esc')
    await nextTick()
    assert.equal(wrapper.find('.group-rename').exists(), false)
    assert.equal((wrapper.find('dialog').element as HTMLDialogElement).open, true)
    assert.equal(wrapper.emitted('action'), undefined)
    wrapper.unmount()
  })
})

describe('QrDialog async race guard', () => {
  test('关闭弹窗后，旧的异步二维码结果不会回写到状态里', async () => {
    let resolveQr: (url: string) => void = () => {}
    const spy = vi.spyOn(qrModule, 'toQrDataUrl').mockImplementation(
      () => new Promise(resolve => { resolveQr = resolve }),
    )
    const wrapper = mount(QrDialog, { attachTo: document.body })
    const vm = wrapper.vm as unknown as { open: (account: unknown) => Promise<void>; close: () => void }
    const pending = vm.open({
      id: 'a1',
      type: 'totp',
      issuer: 'GitHub',
      name: 'dev',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 0,
      encoding: 'standard',
    })
    vm.close()
    resolveQr('data:image/png;base64,STALE')
    await pending
    await flushPromises()

    expect(wrapper.find('.qr-frame img').exists()).toBe(false)
    spy.mockRestore()
    wrapper.unmount()
  })
})

describe('ContextMenu keyboard navigation', () => {
  test('打开后聚焦首项，支持上下方向键循环切换焦点', async () => {
    const wrapper = mount(ContextMenu, {
      attachTo: document.body,
      props: {
        x: 20,
        y: 20,
        items: [
          { action: 'copy', label: '复制验证码' },
          { action: 'edit', label: '编辑' },
          { action: 'trash', label: '移到废纸篓', danger: true },
        ],
      },
    })
    await flushPromises()
    const items = wrapper.findAll('button[role="menuitem"]')
    assert.equal(document.activeElement, items[0].element)

    await wrapper.find('.context-menu').trigger('keydown', { key: 'ArrowDown' })
    assert.equal(document.activeElement, items[1].element)

    await wrapper.find('.context-menu').trigger('keydown', { key: 'ArrowUp' })
    assert.equal(document.activeElement, items[0].element)

    await wrapper.find('.context-menu').trigger('keydown', { key: 'End' })
    assert.equal(document.activeElement, items[2].element)

    wrapper.unmount()
  })
})
