# AutoLogin v0.9.11

发布日期：2026-11-06

## 更新内容

- 书签页关闭全部标签页后，隐藏左侧分组栏和右侧表格骨架。
- 书签页零标签状态改为显示与账号页一致的数据库空状态。
- 在书签页点击“新建数据库”会创建书签标签页，并自动返回书签视图。

## 更新源

- 默认 CDN：`https://aptimlvstic.github.io/AutoLogin/updates/`
- 可通过 `resources/update-config.json` 的 `cdnBaseUrl` 或环境变量 `AUTOLOGIN_UPDATE_CDN_URL` 替换为自有 HTTPS CDN。
- 设置 `AUTOLOGIN_DISABLE_UPDATE_CDN=1` 可强制使用 GitHub Releases。

## 安装

- 使用 `AutoLogin-0.9.11-x64.exe` 安装。
- 自动更新依赖发布资产中的 `latest.yml`、`AutoLogin-0.9.11-x64.exe.blockmap` 和同版本安装包。
