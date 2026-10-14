<p align="center"><img src="utools/logo.png" alt="FunOTP" width="88"></p>

# utools-funotp

uTools 两步验证码插件 — 本地管理多个 TOTP 账号，离线生成 Google Authenticator 兼容的动态验证码。

## 特性

- **本地计算**：验证码由本机按 RFC 4226 / RFC 6238 计算，插件自身不请求任何第三方服务（WebDav 备份除外，需你手动配置）。
- **标准兼容**：TOTP 与 HOTP，SHA1 / SHA256 / SHA512，4–10 位验证码，自定义周期，另支持 Steam 令牌。
- **多种添加方式**：截屏扫码、图片扫码、剪贴板扫码、粘贴 `otpauth://` 链接、手动输入。
- **批量导入**：支持每行一条 `otpauth://` 的文本文件，以及 Google Authenticator「导出账号」生成的 `otpauth-migration://` 迁移二维码。
- **uTools 集成**：主输入框直接搜索账号并回车复制验证码；可为常用账号注册独立关键字；复制后自动退出插件，随手粘贴。
- **备份**：本地 JSON 备份还原、WebDav 备份还原、导出 `otpauth://` 链接给其他验证器。
- **界面**：浅色 / 深色 / 跟随系统，分组管理，倒计时圆环，最后 5 秒提示下一个验证码。
- **键盘操作**：点一下插件界面把焦点交给它之后，方向键选中卡片、`Home` / `End` 跳到首尾、回车复制、`Esc` 取消选中。（在 uTools 的搜索框里打字时按键不会传进插件，想搜完直接回车复制请用主输入框搜索。）

## 开发

```bash
pnpm install
pnpm test          # 单测 + 组件测试，带覆盖率阈值
pnpm test:watch    # 改一行跑一次，不算覆盖率
pnpm typecheck     # vue-tsc，外加 src/lib 那一层的严格模式
pnpm run dev       # 浏览器预览，数据落在 localStorage
sh build.sh        # 校验并产出 utools/dist/
```

在 uTools 开发者工具里导入 `utools/plugin.json` 即可调试。

### 最小使用示例

将验证码链接粘贴到 uTools 输入框：

```text
otpauth://totp/GitHub:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub
```

选择“添加两步验证账号”后，搜索账号并回车即可复制当前验证码。

### `data/` 目录

`data/` 用于放本地调试用的真实 `otpauth://` 链接，**已在 `.gitignore` 中排除，不会提交到仓库**。里面是明文密钥，请勿分享或上传。

## 数据与安全

- 账号存放在 uTools 的数据库（`dbStorage`）里，卸载插件会一并删除，请提前备份。
- **`dbStorage` 属于 uTools 的同步数据库**：如果你在 uTools 里开启了数据同步，明文密钥会随 uTools 账号同步到云端，并下发到你登录的其他设备。只想让密钥留在本机的话，请关闭 uTools 的数据同步功能。
- WebDav 的服务器地址、用户名和密码同样存在 `dbStorage` 里，受上一条约束。
- 备份文件与导出的 `otpauth://` 链接都是**明文密钥**，拿到的人可以生成你的验证码，请妥善保管。
- 启用 WebDav 备份或还原时，明文备份会上传至或下载自你配置的服务器。请只使用可信的 HTTPS WebDav 服务，并妥善保护服务器账号和备份文件。
- 删除账号前请确认对应网站已关闭两步验证，或已保存好恢复码 —— 密钥删掉无法找回。
- 本地数据读不出来时插件会进入只读模式并提示，绝不会用空数据覆盖已有密钥。

## 结构

```
utools/                uTools 清单、预加载脚本、图标与构建脚本
src/lib/base32.ts     Base32 编解码
src/lib/otp.ts        HOTP / TOTP 计算
src/lib/otpauth.ts    otpauth 链接与迁移二维码的解析、生成
src/lib/qr.ts         二维码识别与生成
src/lib/core.ts       账号规范化、校验、迁移
src/lib/state.ts      状态 schema 与加载
src/composables/      界面状态与 uTools 集成
src/components/       Vue 组件
```

---

## 关于 farfarfun

[farfarfun](https://github.com/farfarfun) 是一个专注于实用工具库的开源组织，
涵盖云存储、数据处理、AI、多媒体与开发工具链等方向。

- 🏠 组织主页：<https://github.com/farfarfun>
- 📧 联系：farfarfun@qq.com

本项目基于 [MIT](LICENSE) 协议开源。
