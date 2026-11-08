# AutoLogin v0.10.0

发布日期：2026-11-08

## 架构更新

- 桌面外壳迁移到 Tauri 2：Rust 负责窗口、单实例、Node sidecar 生命周期、JSON-RPC 路由、开发者工具和更新安装。
- 保留现有 React 界面与 Node 业务 sidecar，以继续提供保险库、账号、书签、日志、回收站、导入导出和浏览器录制能力。
- 安装版不再携带 Electron 运行时；旧版 `%APPDATA%\AutoLogin` 数据目录、自定义数据位置和浏览器会话继续兼容。
- 更新检查切换到 Tauri 兼容实现，支持下载进度、取消下载、安装更新和软件日志。

## 发布信息

- Tauri 仓库：`https://github.com/AptimLvStic/Tauri`
- 默认 CDN：`https://aptimlvstic.github.io/Tauri/updates/`
- GitHub Releases 回退：`https://github.com/AptimLvStic/Tauri/releases`
- 安装包：`AutoLogin_0.10.0_x64-setup.exe`

## 注意

- 当前安装包未配置 Authenticode 签名，Windows SmartScreen 可能显示未识别发布者提示。
- 发布资产必须同时包含安装包与 `latest.yml`，否则应用内自动更新无法工作。
