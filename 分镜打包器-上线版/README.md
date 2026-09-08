# storyboard-packager（分镜命名打包器）

一个给视频分镜排序、备注和批量改名的小工具。它在浏览器本地读取视频，按连续分镜槽安排主镜头和补镜头，再下载 ZIP 或写入用户选择的文件夹。产品版本 `0.1`（`0.1.0`），作者 sk0l。

## 功能

- 一次拖入多个视频、多个独立文件夹或混合批次；逐项递归读取、去重并保留相对路径。
- 一个连续的分镜槽列表；填入最后一个槽位后只增加一个尾部空槽。
- 集号只是当前命名前缀。改成 `3` 会把现有槽位改名为 `3-1`、`3-2`，不会生成第三套编排。
- 主镜头命名为 `3-1.mp4`；补镜头命名为 `3-1_补镜头_01_备注.mp4`。备注原值和清洗后的导出名都会显示。
- 总池默认隐藏已编排素材，可切换查看并看到具体主/补镜头槽位；移回总池后立即出现。
- 总池按文件最后修改时间旧→新排列，显示完整本地时间；浏览器无法读取 Windows 真实创建时间。
- 悬停或聚焦才静音预览，同一时刻只播放一个视频；缺失文件明确提示重新关联。
- 本地历史最多 20 条，自动更新当前记录；“保存版本”才创建独立快照。工程 JSON 不包含视频 Blob、句柄或绝对路径。
- 导出根目录包含视频、`manifest.json` 和带 BOM 的 `manifest.csv`；CSV 会防止常见公式注入，JSON 保留原始值。

## 安装与构建

需要 Node.js 22.13 或更高版本与 pnpm。

```bash
pnpm install --frozen-lockfile
pnpm build
```

构建成功后仅保留 `dist/client` 静态成品，并自动收集实际打包依赖的完整许可证。仓库包含已构建版本，下载仓库 ZIP 并解压后即可按下方 Windows 步骤使用。不需要登录、API key、云服务或远程上传。

## Windows 使用

双击 `启动器.cmd`，在弹窗选择“新建编排”或“恢复上一次”。启动器使用系统 PowerShell 在固定的 `127.0.0.1:8765` 提供静态页面；关闭所有页面后服务会自动退出。没有管理员权限或 Node.js 也能运行已构建的版本。

1. 把视频/文件夹批量拖入总池，或点击选择按钮。
2. 输入命名前缀集号，不填写总集数；选中素材后点击槽位按钮，或拖到主/补镜头区域。
3. 在补镜头输入备注并调整顺序，检查实时导出名。
4. 点击“下载 ZIP”或在支持的浏览器中“导出到文件夹”。已分配但未重新关联的素材不会导出。

## 隐私边界

视频只在当前浏览器中读取、预览、缓存和导出，应用没有登录、OAuth、遥测、分析、广告、远程上传或云端存储。IndexedDB 只保存编排元数据和可选的本地视频缓存；历史保存、裁剪和 Blob 清理在同一事务中完成，避免并发保存时误删仍被引用的视频缓存。历史面板提供需二次确认的“清空本地缓存/历史”入口。

应用不会修改、移动或重命名原文件。文件夹导出只会在用户明确选择的目录中新建唯一命名的输出目录，已有文件不会被覆盖；中断时会清理本次文件，无法清理时留下 `.incomplete.json` 标记。

## 兼容性与已知限制

- Chrome/Edge 桌面版提供完整的目录读取与逐文件导出；其他浏览器回退到普通文件选择和 ZIP。
- 工程 JSON 最大 4 MB、32 层嵌套；素材总数最多 5000。单次导入共享 5000 个文件、10000 个遍历条目、16 层目录深度和 100 GB 总大小的限制。
- ZIP 总量达到 750 MB 会提示内存风险，超过 2 GB 会阻止 ZIP，建议逐文件导出。
- 浏览器权限、缓存配额或原文件位置变化会导致“需重新关联”；应用不能直接打开 Explorer 的真实路径。
- 本地服务只提供静态文件，不是通用 HTTP 服务；请求受 Host/Origin、请求头、响应大小和客户端 TTL 限制。

## 0.1 发布信息

版本：`0.1.0`（对外显示 `0.1`）

作者：sk0l

许可证：本项目 MIT；第三方依赖许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 致谢与来源

实际采用的依赖：感谢 [@gildas-lormeau 的 zip.js](https://github.com/gildas-lormeau/zip.js) 及其 BSD-3-Clause 许可证。本项目用它在浏览器中生成 ZIP

公开交互/流程概念参考：感谢 [@taruma 的 ShotBase](https://github.com/taruma/shotbase)、[@albozes 的 ShotBuddy](https://github.com/albozes/shotbuddy) 和 [@BerndHagen 的 Batch-File-Renamer](https://github.com/BerndHagen/Batch-File-Renamer)。[@shuffleo 的 storyboard-tool](https://github.com/shuffleo/storyboard-tool) 

评估但未采用：[@Touffy 的 client-zip](https://github.com/Touffy/client-zip) 与 [@clauderic 的 dnd-kit](https://github.com/clauderic/dnd-kit)。它们没有进入本项目依赖，也没有复制其代码。

## 维护

安全边界见 [SECURITY.md](./SECURITY.md)，版本记录见 [CHANGELOG.md](./CHANGELOG.md)。
