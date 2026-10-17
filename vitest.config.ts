import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

// 测试配置单独放一个文件，和同族另外三个插件一致：这里只声明 test，插件和构建选项
// 从 vite.config.ts 合并进来，不重复写一份。
//
// 当初分文件是迫不得已 —— vitest 2 自带的是 vite 5 的类型，把 test 字段直接写进
// vite.config.ts 会让 @vitejs/plugin-vue 的类型两边对不上。工具链升到 vite 7 + vitest 4
// 之后这个理由没了，但分开仍然是更清楚的写法，所以保留。
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
      //
      // 这组数字在升到 vitest 4 时整体下调过一次（原来是 79/81/80/79），不是测试少了
      // —— 91 条用例一条没动，是 v8 provider 的算法换了。同一份代码两边量出来：
      //   vitest 2：语句 925/1167、分支 369/455、函数 97/120（语句和行数完全相等，
      //             说明它根本没按 AST 分语句）
      //   vitest 4：语句 631/867、分支 373/574、函数 135/192
      // 分母一多一少说明新版是按真实语法结构算的 —— 函数从 120 个涨到 192 个，旧版
      // 连一半函数都没看见。所以新数字更可信，棘轮按它重钉。
      thresholds: { statements: 72, branches: 64, functions: 70, lines: 75 },
    },
  },
}))
