# 更新日志

## 1.0.1

- 使用共享 UPXS 打包工具和组织 Secrets，公开维护本项目 ID，提供安装测试包与校验和。

## 1.0.0

### 新增

- 支持离线 TOTP、HOTP 和 Steam 动态验证码。
- 支持 otpauth 链接、二维码与 Google Authenticator 迁移数据导入。

### 修复

- 本地数据读取失败时进入只读状态，避免覆盖已有密钥。

### 变更

- 统一使用 pnpm、Vite 和 Vitest 构建及测试。

### 废弃

- 无。
