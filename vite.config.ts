import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  build: {
    outDir: 'utools/dist',
    // uTools 8.0 固定跑在 Electron 34 / Chromium 132 上，不用为更老的浏览器降级语法。
    // https://next.u-tools.cn/docs/developer/information/version.html
    target: 'chrome132',
  },
  plugins: [vue()],
})
