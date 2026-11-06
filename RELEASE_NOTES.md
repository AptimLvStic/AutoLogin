# AutoLogin v0.9.10

发布日期：2026-11-06

## 更新内容

- 回退 v0.9.9 的主工作区底色融合：恢复左侧分组栏、右侧内容卡片与分隔线层级。
- 更新检查与下载优先使用项目 CDN，CDN 不可用时自动回退 GitHub Releases。
- 增量更新失败并降级为完整安装包时，进度区域会明确显示“增量更新失败，正在下载完整安装包…”，不再表现为进度无故重置。
- 更新器日志写入软件日志，便于排查 blockmap、差分下载和更新源异常。
- 数据库以磁盘文件为准：外部删除的 `.autologin` / `.kdbx` 文件不会被后续保存或新建数据库重新写回。
- 关闭全部账号数据库标签后，隐藏分组栏和表格骨架，显示居中的欢迎页，并提供“新建数据库”和“打开本地数据库”入口。
- NSIS 安装包启用 `store-asar` 差分打包，后续版本可减少重复下载量。

## 更新源

- 默认 CDN：`https://aptimlvstic.github.io/AutoLogin/updates/`
- 可通过 `resources/update-config.json` 的 `cdnBaseUrl` 或环境变量 `AUTOLOGIN_UPDATE_CDN_URL` 替换为自有 HTTPS CDN。
- 设置 `AUTOLOGIN_DISABLE_UPDATE_CDN=1` 可强制使用 GitHub Releases。

## 安装

- 使用 `AutoLogin-0.9.10-x64.exe` 安装。
- 自动更新依赖发布资产中的 `latest.yml`、`AutoLogin-0.9.10-x64.exe.blockmap` 和同版本安装包。
