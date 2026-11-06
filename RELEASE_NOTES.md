# AutoLogin v0.9.12

发布日期：2026-11-06

## 更新内容

- 账号页和书签页在零标签状态下隐藏顶部右侧的新增、导入、导出按钮。
- 书签页空状态改为独立的书签文案、图标和操作入口，不再复用账号数据库文案。
- 书签页空状态提供“新建书签标签页”和“导入浏览器书签”，账号页继续提供数据库新建与打开入口。

## 更新源

- 默认 CDN：`https://aptimlvstic.github.io/AutoLogin/updates/`
- 可通过 `resources/update-config.json` 的 `cdnBaseUrl` 或环境变量 `AUTOLOGIN_UPDATE_CDN_URL` 替换为自有 HTTPS CDN。
- 设置 `AUTOLOGIN_DISABLE_UPDATE_CDN=1` 可强制使用 GitHub Releases。

## 安装

- 使用 `AutoLogin-0.9.12-x64.exe` 安装。
- 自动更新依赖发布资产中的 `latest.yml`、`AutoLogin-0.9.12-x64.exe.blockmap` 和同版本安装包。
