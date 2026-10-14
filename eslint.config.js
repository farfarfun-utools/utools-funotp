import js from '@eslint/js'
import globals from 'globals'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

// 之前这里只有一条 no-unused-vars，没有 parser 也没有插件：.ts 和 .vue 其实都没被检查过。
export default tseslint.config(
  { ignores: ['utools/dist/**', 'node_modules/**'] },

  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],

  // 渲染进程：浏览器环境，.vue 里的 <script lang="ts"> 要交给 ts parser。
  {
    files: ['src/**/*.{ts,vue}', 'tests/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },

  // preload 和它旁边的模块跑在 uTools 的 Node 侧：CommonJS，而且 utools 由宿主注入到全局。
  {
    files: ['utools/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, utools: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // 设置抽屉收到的 settings 就是 useFunOtp 里那个 state.settings 本体：
  // 直接 v-model 改它，UI 立刻生效，关闭时再按 JSON 快照决定要不要落盘。
  // 改成 emit 回传等于把同一份数据抄两遍，这里是有意为之。
  {
    files: ['src/components/SettingsDialog.vue'],
    rules: { 'vue/no-mutating-props': 'off' },
  },

  // 构建脚本跑在 Node 里。
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },

  {
    rules: {
      // 参数里的 _ 前缀表示「签名需要但用不到」，别报它。
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // window.utools / window.funotp 的形状由宿主决定，边界上还需要 any。
      '@typescript-eslint/no-explicit-any': 'off',
      // 单文件组件的属性顺序不值得为它改一遍模板。
      'vue/attributes-order': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': ['warn', { html: { void: 'any', normal: 'any', component: 'always' } }],
      'eqeqeq': ['warn', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
)
