# AutoLogin v0.4.1

发布日期：2026-11-03

AutoLogin v0.4.1 聚焦主题命名、代理测试配置、导入弹窗可用性和中文 CSV 兼容性。

## 主要更新

- 外观主题预设 `Magpie` 的用户可见名称调整为 `defalut`，内部兼容键保持不变。
- 修复颜色模式设置行左侧标签与右侧切换控件未垂直居中的问题。
- 网络代理“测试连接”旁新增齿轮按钮，打开可编辑“测试 URL”的 Popover；测试 URL 随代理配置持久化。
- KDBX 导入文件摘要改为居中的紧凑布局，长文件名自动省略，减少无效留白。
- 修复 KDBX 主密码输入时焦点被拖到关闭按钮的问题，支持连续输入并在弹窗打开时自动聚焦密码框。
- CSV 导入新增 UTF-8 BOM、UTF-16LE/BE BOM 和 GB18030 回退解码，修复中文账号显示乱码。

## 验证

- TypeScript 严格模式类型检查通过。
- Vitest 单元测试通过：覆盖 KDBX/CSV 导入、编码识别、弹窗焦点保持、保险库安全、日志和录制流程。
- Playwright Electron E2E 通过：覆盖默认主题显示、测试 URL Popover、跟随系统代理禁用态和配置持久化。
- Windows NSIS x64 生产构建通过。

## 安装

- 系统要求：Windows 10 22H2 或 Windows 11 x64。
- 使用 `AutoLogin-0.4.1-x64.exe` 安装。
- 安装包未配置 Authenticode 代码签名证书，Windows SmartScreen 可能显示未知发布者提示。
- 卸载程序默认保留本地保险库、备份、日志和浏览器会话；如需彻底清除，请先在应用内执行“清除全部数据”。

## 说明

- 所有目标网站仍通过 Windows 默认的 Google Chrome 或 Microsoft Edge 打开，不在 AutoLogin 内嵌网页。
- AutoLogin 不绕过验证码、短信验证、2FA 或第三方风控。
- KeePassXC 导入当前不读取密钥文件、附件或 TOTP 字段。
- “检查更新”仅读取 GitHub Releases，不自动下载或安装更新。
