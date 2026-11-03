# AutoLogin

AutoLogin 是一款面向 Windows 10/11 x64 的本地优先登录工作台。它把常用网站的登录入口、多个账号和独立浏览器会话集中到一个桌面应用中，通过 Windows 默认浏览器打开网站，并在可识别时自动填充、自动提交；遇到验证码、短信验证或二次验证时停止提交，交由用户人工完成。

当前版本为 `0.2.2` MVP，不包含云同步、账号系统、遥测、自动下载安装更新、TOTP/2FA 自动化，也不会绕过任何第三方验证码或风控。

## 功能

- 创建本地加密保险库，主密码最低 10 位并显示强度。
- 默认闲置 10 分钟自动锁定，可设置为 5、10、15 或 30 分钟。
- 管理站点、站点分组、多个账号、收藏、搜索、最近使用和账号编辑；站点分组位于“全部账号”的展开子菜单中。
- 按站点分组批量打开账号；所选账号在同一 Chromium 窗口的多个标签页中打开，并在主菜单栏显示成功、失败和待人工处理数量。
- 调用 Windows 默认的 Chromium 浏览器打开网站，不在 AutoLogin 内嵌网页；当前支持 Google Chrome 和 Microsoft Edge。
- 单账号登录使用独立浏览器配置目录，登录会话可跨启动复用。
- 设置中提供多款主题预设、自定义四色主题、独立恢复默认主题，以及 80%–125% 的界面比例滑动调节和恢复默认比例。
- 通用识别账号密码字段并自动填充，可配置是否自动提交。
- 检测验证码或二次验证输入区域，自动停止提交并聚焦人工输入。
- 录制多步骤登录流程，只保存字段选择器、点击和按键，不保存字段值。
- 登录失败时提供切换浏览器、重新尝试、复制账号、复制密码和重新录制等兜底操作。
- 批量登录失败及需要人工处理的记录写入本地脱敏日志，并可在主菜单状态和设置中查看。
- 来源白名单校验；跨来源跳转时暂停自动填充并要求用户确认。
- 支持清除单个账号的网站会话，以及清除全部本地数据。
- 设置入口位于主菜单栏，提供关于软件、手动检查更新、打开发布页、迁移数据目录和查看失败日志。

## 安全设计

- 主进程独占主密码、派生密钥和账号密码明文。
- Argon2id 参数为 64 MiB 内存、3 次迭代、并行度 1，输出 256 位密钥。
- 完整保险库使用 AES-256-GCM 加密，随机 16 字节盐和 12 字节 nonce。
- 保险库采用临时文件、`fsync` 和原子替换写入，并保留一份加密 `.bak`。
- 渲染器启用 `contextIsolation`、`sandbox` 和 CSP，禁用 Node.js。
- IPC 使用固定白名单和 Zod 校验，并校验调用来源。
- 自动填充代理运行在默认浏览器的隔离 CDP world 中，目标网页无法访问 Electron、Node.js 或 `window.autologin`。
- 浏览器调试连接仅绑定 `127.0.0.1` 的随机端口，并且只在活动登录会话期间存在。
- 仅允许 `http:` 和 `https:` 地址，禁止 `file:`、`data:` 和 `javascript:`。
- 每次页面加载最多执行一次通用自动提交。
- 日志不记录密码、Cookie、验证码或带查询参数的完整 URL。

更完整的数据处理说明见 [PRIVACY.md](PRIVACY.md)。

## 本地数据

Windows 默认用户数据目录：

```text
%APPDATA%\AutoLogin
```

可在“设置 → 数据保存位置”中迁移到其他目录。迁移后需重启 AutoLogin；账号及配置会随保险库一起迁移。

其中包含：

- `vault.enc`：加密保险库。
- `vault.enc.bak`：加密备份。
- `session-index.json`：账号 ID 索引，不包含密码。
- `BrowserProfiles/<accountId>/`：单账号登录使用的浏览器 Cookie、缓存和本地存储。
- `BrowserProfiles/batch/`：批量打开时复用的浏览器配置目录；同一批次内不同站点仍按浏览器来源隔离，但同一站点的多个账号共享 Cookie。
- `logs/login-failures.jsonl`：批量登录失败与人工处理记录，不含密码、Cookie、验证码或完整 URL。

网站会话由默认浏览器和 Windows 用户级机制保护，不使用保险库主密码额外加密。清除单账号会话会删除对应账号的独立浏览器配置目录；批量窗口使用共享的 `batch` 配置目录。

NSIS 卸载程序默认保留上述用户数据。卸载前如需彻底删除，请先在应用设置中使用“清除全部本地数据”。

## 开发环境

- Windows 10 22H2 或 Windows 11 x64。
- Node.js 22 或更新版本。
- npm。

安装依赖并启动开发环境：

```powershell
npm install
npm run dev
```

类型检查与生产构建：

```powershell
npm run typecheck
npm run build
```

## 测试

单元测试：

```powershell
npm test
```

Electron E2E 使用本地测试站点，不访问公网：

```powershell
$env:AUTOLOGIN_E2E_NO_SANDBOX='1'
npm run test:e2e
```

当前自动化覆盖：

- 创建保险库、错误密码、锁定与解锁。
- AES-GCM 篡改检测、主备同时损坏和加密备份恢复。
- 修改主密码与自动锁定设置持久化。
- 账号新增、登录、会话复用和会话清除。
- 批量打开、站点分组、成功/失败状态和失败日志。
- 验证码人工接管。
- 多步骤登录录制与回放。
- 搜索、收藏、剪贴板复制。
- 自定义站点选择器、账号编辑弹窗和设置中的关于/更新/数据位置区域。
- 主题预设、自定义主题、界面比例及独立恢复默认设置。
- 站点分组在“全部账号”子菜单展示，批量登录在同一浏览器窗口创建多个标签页。
- 跨来源跳转暂停自动填充。
- 目标页面不存在于 Electron 窗口列表中，确认没有内嵌打开网站。
- 默认浏览器中的页面无法访问 Node.js 和 Electron API。
- 锁定状态下清除全部本地数据。

公开站点人工回归需要独立测试账号和目标站点清单，当前交付未包含这部分结果。标准表单填充兼容性不代表对所有网站作出保证；网站主动阻止自动化、要求浏览器扩展或受企业策略限制时可能无法自动填充。

## 打包

生成 NSIS x64 安装包：

```powershell
$env:ELECTRON_BUILDER_CACHE=(Resolve-Path 'work\electron-builder-cache').Path
npm run package
```

输出目录为 `outputs/`。当前仓库没有 Authenticode 证书，因此只能交付未签名测试安装包。正式公开下载前应配置代码签名：

```powershell
$env:CSC_LINK='C:\secure\codesign.pfx'
$env:CSC_KEY_PASSWORD='<证书密码>'
npm run package
```

不要把证书、密码或私钥提交到仓库。

## 已知限制

- 不绕过验证码、短信验证、2FA 或网站风控。
- 自动填充要求 Windows 默认浏览器属于 Chromium 系；当前支持 Google Chrome 和 Microsoft Edge，Firefox 和 Internet Explorer 不支持。
- 批量打开会在同一 Chromium 配置目录中创建多个标签页；同一站点的多个账号共享 Cookie，不应在同一批次中同时登录这些账号。
- 不承诺兼容所有登录页面，尤其是多因素、强反自动化或阻止调试连接的网站。
- “检查更新”只读取 GitHub Releases 信息并跳转发布页，不自动下载或安装更新。
- 当前 GitHub 仓库为私有仓库。未携带访问凭据的安装包调用 Releases API 会收到 `404`，因此“检查更新”会显示不可用；如需向终端用户开放该功能，需将发布仓库设为公开或提供公开更新端点。
- 网站 Cookie 不受主密码直接加密；忘记主密码时可通过“清除全部数据”移除会话。
- 未签名的测试安装包可能触发 Windows SmartScreen 提示。

## 目录

```text
src/main/        Electron 主进程、保险库、登录会话
src/preload/     主窗口 IPC bridge 和页面自动填充代理源码
src/renderer/    React 界面
src/shared/      类型、Zod schema、URL 安全工具
tests/unit/      Vitest 单元测试
tests/e2e/       Playwright Electron E2E 与本地夹具
resources/       应用图标
```

## 许可证

当前项目标记为 `UNLICENSED`，仅用于本任务交付。对外发布前需补充正式许可证与品牌审查。
