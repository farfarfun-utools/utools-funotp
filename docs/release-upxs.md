v1.0.3：统一通过根目录 `build.sh` 构建前端，npm 包名调整为 `@farfarfun/utools-funotp`；插件显示名和用户数据格式不变。

密钥随行 UPXS 正式版，官方插件项目 ID：`zwrjnuoi`。

此前版本新增 `list_otp_accounts` AI/MCP 工具，只返回账号 ID、服务商与名称，不返回密钥、动态码或备注。

下载 `utools-funotp-1.0.3.upxs` 后导入 uTools。此包通过 GitHub Actions 构建，使用统一的 `utools-devtools` 生成，并完成认证解密、清单资源、插件 ID 和 ASAR 完整性校验；提供 `SHA256SUMS` 核对下载文件。

三个敏感字段由组织 Secrets 注入，仓库只保存公开的项目配置。相同打包链路已由用户在 FunCalc 上实机安装验证；本插件自身的安装和功能仍待实机确认。
