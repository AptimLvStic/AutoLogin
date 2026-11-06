# AutoLogin v0.9.13

发布日期：2026-11-06

## 更新内容

- 左侧主菜单栏、账号/书签二级分组栏与业务表格区统一为相同的白色背景。
- 账号工作区红框区域不再出现灰色底色断层，同时保留分隔线、选中状态和卡片阴影。
- 深色主题继续根据当前主题变量自动适配。

## 更新源

- 默认 CDN：`https://aptimlvstic.github.io/AutoLogin/updates/`
- 可通过 `resources/update-config.json` 的 `cdnBaseUrl` 或环境变量 `AUTOLOGIN_UPDATE_CDN_URL` 替换为自有 HTTPS CDN。
- 设置 `AUTOLOGIN_DISABLE_UPDATE_CDN=1` 可强制使用 GitHub Releases。

## 安装

- 使用 `AutoLogin-0.9.13-x64.exe` 安装。
- 自动更新依赖发布资产中的 `latest.yml`、`AutoLogin-0.9.13-x64.exe.blockmap` 和同版本安装包。
