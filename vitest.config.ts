import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

// 测试配置单独放一个文件：vitest 2 自带的是 vite 5 的类型，把 test 字段直接写进
// vite.config.ts（用的是 vite 6 的 defineConfig）会让 @vitejs/plugin-vue 的类型两边对不上。
// 这里只声明 test，插件和构建选项从 vite.config.ts 合并进来，不重复写一份。
export default mergeConfig(viteConfig, defineConfig({
  test: {
    // 默认环境留 node：纯函数那些测试不需要 DOM，起 jsdom 每个文件要多花半秒。
    // 要 DOM 的组件测试在文件头写 `// @vitest-environment jsdom`。
    setupFiles: ['tests/dialog.setup.ts'],
    coverage: {
      provider: 'v8',
      // 只统计能测的部分：.vue 里大半是模板，覆盖率数字说明不了什么，
      // 组件行为由 tests/AccountCard|ConfirmDialog|SettingsDialog.test.ts 盯着，不靠这里的阈值兜。
      include: ['src/lib/**', 'src/composables/**', 'utools/webdav.js'],
      reporter: ['text-summary'],
      // 棘轮，和 tsconfig.strict.json 一个路子：按当前实际值往下取整钉住，
      // 新代码不带测试就会把数字拉下来、CI 变红。补了测试记得把阈值跟着提上去。
      thresholds: { statements: 79, branches: 81, functions: 80, lines: 79 },
    },
  },
}))
