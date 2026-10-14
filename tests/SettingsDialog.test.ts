// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, test, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import SettingsDialog from '../src/components/SettingsDialog.vue'
import { DEFAULT_SETTINGS } from '../src/lib/state'

// WebDav 那一屏的解析和出错提示都写在组件里，只有挂起来才测得到。
// 这里盯的是三件出过问题的事：畸形响应不能静默变成「暂无数据」、日期解析不出来不能把排序搅乱、
// 备份内容必须用上层给的那一份（两条备份路径同一份数据）。
const LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/FunOTP/</d:href>
    <d:propstat><d:prop><d:getlastmodified>Sat, 01 Mar 2025 00:00:00 GMT</d:getlastmodified></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/FunOTP/old.json</d:href>
    <d:propstat><d:prop>
      <d:getlastmodified>Tue, 01 Oct 2024 00:00:00 GMT</d:getlastmodified>
      <d:getcontentlength>2048</d:getcontentlength>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/FunOTP/broken.json</d:href>
    <d:propstat><d:prop>
      <d:getlastmodified>前天</d:getlastmodified>
      <d:getcontentlength>512</d:getcontentlength>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/FunOTP/new.json</d:href>
    <d:propstat><d:prop>
      <d:displayname>最新备份.json</d:displayname>
      <d:getlastmodified>Sat, 01 Feb 2025 00:00:00 GMT</d:getlastmodified>
      <d:getcontentlength>1024</d:getcontentlength>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`

const CONFIG = { host: 'https://dav.example.com/dav/', username: 'me', password: 'pw' }

interface Harness {
  bridge?: Record<string, unknown>
  confirm?: () => Promise<boolean>
  /** 传 null 表示从没配置过 WebDav。 */
  stored?: typeof CONFIG | null
}

function setup({ bridge = {}, confirm = () => Promise.resolve(true), stored = CONFIG }: Harness = {}) {
  const store = new Map<string, unknown>(stored ? [['funotp-webdav', stored]] : [])
  vi.stubGlobal('utools', {
    dbStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key) : null),
      setItem: (key: string, value: unknown) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  })
  vi.stubGlobal('funotp', {
    webdavBackup: () => Promise.resolve(),
    webdavList: () => Promise.resolve(LIST_XML),
    webdavRestore: () => Promise.resolve('{}'),
    webdavDelete: () => Promise.resolve(),
    ...bridge,
  })
  const wrapper = mount(SettingsDialog, {
    attachTo: document.body,
    props: {
      settings: structuredClone(DEFAULT_SETTINGS),
      groups: [],
      accountCount: 1,
      backupContent: () => '{"version":1}',
      confirm,
    },
  })
  return wrapper
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text)
  assert.ok(found, `找不到按钮「${text}」`)
  return found
}

// WebDav 的按钮在「数据」页里，默认页是「显示」。
async function dataTab(wrapper: VueWrapper) {
  await button(wrapper, '数据').trigger('click')
  return wrapper
}

function rows(wrapper: VueWrapper) {
  return wrapper.findAll('.webdav-file-list > div').map(row => ({
    name: row.find('span').text(),
    size: row.find('small').text(),
    restore: row.findAll('button')[0],
    remove: row.findAll('button')[1],
  }))
}

afterEach(() => vi.unstubAllGlobals())

test('备份文件按修改时间倒序，非 json 不列出来', async () => {
  const wrapper = await dataTab(setup())
  await button(wrapper, '从 WebDav 还原').trigger('click')
  await flushPromises()

  assert.deepEqual(rows(wrapper).map(row => row.name), ['最新备份.json', 'old.json', 'broken.json'])
  // 日期解析不出来的按最旧排，不能变成 NaN 把整个顺序搅乱。
  assert.equal(rows(wrapper)[0].size, '1.00kb')
  assert.equal(wrapper.find('.webdav-empty').exists(), false)
})

test('响应不是 XML 时报错，不显示成「暂无数据」', async () => {
  const wrapper = await dataTab(setup({ bridge: { webdavList: () => Promise.resolve('<!DOCTYPE html><title>502</title>') } }))
  await button(wrapper, '从 WebDav 还原').trigger('click')
  await flushPromises()

  const messages = wrapper.emitted('message') || []
  assert.match(String(messages.at(-1)?.[0]), /不是有效的 WebDav 响应/)
  assert.equal(messages.at(-1)?.[1], true, '要走报错样式')
  assert.equal(wrapper.find('.webdav-file-list').exists(), false)
})

test('没配置 WebDav 就直接提示，不去发请求', async () => {
  let called = 0
  const bridge = { webdavList: () => { called += 1; return Promise.resolve(LIST_XML) } }
  const wrapper = await dataTab(setup({ bridge, stored: null }))

  await button(wrapper, '从 WebDav 还原').trigger('click')
  await flushPromises()
  assert.equal(called, 0)
  assert.match(String((wrapper.emitted('message') || []).at(-1)?.[0]), /请先配置 WebDav/)
})

test('备份用的是上层给的那份内容', async () => {
  const sent: unknown[] = []
  const bridge = { webdavBackup: (_config: unknown, content: string) => void sent.push(content) }
  const wrapper = await dataTab(setup({ bridge }))

  await button(wrapper, '备份到 WebDav').trigger('click')
  await flushPromises()
  // 组件自己再序列化一份的话，本地备份和云端备份就会慢慢漂成两种格式。
  assert.deepEqual(sent, ['{"version":1}'])
  assert.match(String((wrapper.emitted('message') || []).at(-1)?.[0]), /已备份到 WebDav/)
})

test('点还原把文件内容交给上层处理', async () => {
  const wrapper = await dataTab(setup({ bridge: { webdavRestore: () => Promise.resolve('{"version":1,"accounts":[]}') } }))
  await button(wrapper, '从 WebDav 还原').trigger('click')
  await flushPromises()

  await rows(wrapper)[0].restore.trigger('click')
  await flushPromises()
  assert.deepEqual(wrapper.emitted('data-file'), [['restore', '{"version":1,"accounts":[]}']])
})

test('删云端备份要先确认', async () => {
  const deleted: string[] = []
  const bridge = { webdavDelete: (_config: unknown, href: string) => void deleted.push(href) }

  const declined = await dataTab(setup({ bridge, confirm: () => Promise.resolve(false) }))
  await button(declined, '从 WebDav 还原').trigger('click')
  await flushPromises()
  await rows(declined)[0].remove.trigger('click')
  await flushPromises()
  assert.deepEqual(deleted, [], '点取消就不该动云端的文件')
  assert.equal(rows(declined).length, 3)

  const accepted = await dataTab(setup({ bridge }))
  await button(accepted, '从 WebDav 还原').trigger('click')
  await flushPromises()
  await rows(accepted)[0].remove.trigger('click')
  await flushPromises()
  assert.deepEqual(deleted, ['/dav/FunOTP/new.json'])
  assert.deepEqual(rows(accepted).map(row => row.name), ['old.json', 'broken.json'], '删掉的那行要就地消失')
})
