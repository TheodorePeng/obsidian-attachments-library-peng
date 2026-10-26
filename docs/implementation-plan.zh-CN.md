> 当前实施以 [1.4.0 方案](implementation-plan-1.4.0.zh-CN.md)及[验收记录](implementation-acceptance-1.4.0-2026-10-26.md)为准。下文保留早期讨论和实施历史。

# Attachments Library Peng 1.1.0 实施计划

本文件记录已批准的实现约束；实际通过项与限制以 [验收记录](implementation-acceptance-2026-10-24.md) 为准。

## 交付边界

工作流为附件 → 配套 Markdown → 原生 Bases → 图片入口 → 引用分析 → 人工预览与可恢复清理。独立 ID 为 `attachments-library-peng`，最低声明 Obsidian 1.13.1。核心能力不依赖 CMS 或 Hover Editor；不接入 OCR、图床、XMP 或专用数据库，不自动提交、推送、发布或升级其他插件。

## 数据与候选规则

默认全 Vault，保留单文件夹模式。默认附件类型为图片 avif/bmp/gif/jpeg/jpg/png/svg/webp、音频 flac/m4a/mp3/ogg/wav/3gp、视频 mkv/mov/mp4/ogv/webm、文档 pdf。扩展名归一化、去重，Markdown 及变体、Base、Canvas 从白名单移除并硬性禁止；隐藏路径、配置、回收站与 Library 不进入候选。候选范围不缩小引用来源范围。

保留原有 attachment、_filePath、_fileType、source、status 和自定义属性。新增 al_schema=1、al_usageCount、al_usageState 与 al_keep；status 保留阅读状态语义。OCR、公式、说明位于 Markdown 正文，新文档有受控预览边界。结构化 YAML 序列化及 Unicode 标签不破坏中文。

旧 Library 中两个关联字段一致的索引原地采用，不搬迁或覆盖正文。新路径为 Library/完整附件路径含原扩展名.md。附件改名保持索引位置，仅更新字段及受控预览；索引移动保持身份。重复关联、字段不一致、目标占用与大小写碰撞保护。外删附件保留索引并显示 missing；外删索引保留附件，明确补建时才重新创建。

首次启动只读；完整补建必须先预览、再确认。成功后才开启同范围增量索引与旧文档派生字段采用。显式单项建立不等于全库补建许可。

## 服务与阶段

| 阶段 | 服务/文件 | 验收约束 |
| --- | --- | --- |
| 1 索引基础 | file-policy、registry、sidecar-manager | 统一白名单、只读采用、正文保全、关联冲突保护 |
| 2 引用分析 | references | Markdown 正文/属性、Canvas file/text、Base 常量；全 Vault 来源、300ms 去抖、串行扫描、缓存新鲜度 |
| 3 管理与清理 | bases-creator、library-view、deletions、dialogs | 原配置备份保留、幂等四视图、60 项分页、当前页选择、统一安全删除 |
| 4 图片入口 | image-navigation | 阅读与 Live Preview 两个适配器、标准 hover-link、清理自身监听和元素 |
| 5 安装验收 | manifest、构建与 CLI | 独立目录、保留 data.json、产物哈希、定向重载、真实场景与恢复记录 |

## Bases 与图片交互

使用官方 BasesView 查询结果、排序和分组，不另建数据库。既有表格和 CMS 保留，追加 All attachments、Orphan candidates、Cleanable、Needs attention 四个 owned 视图。实时状态再次筛选，unknown 不进入 Cleanable。全选只表示当前页，换页/筛选清空选择。图片懒加载；其他媒体显式预览时才加载。普通属性编辑交给原表格、CMS 或 Markdown。

图片按钮左键当前索引、Command/Ctrl 左键来源、中键索引新标签、右键明确菜单。悬浮始终指向索引，由 Page Preview 和可选 Hover Editor 处理；可选择原生 Command 点击。未索引图片必须点击并确认才建立，远程图片不下载。按钮不改写笔记源码；渲染容器未挂载时也不得产生添加/移除循环。

## 引用与删除门禁

直接附件与索引入链按来源文件集合去重。仅排除自身管理属性、受控预览和能唯一识别的旧自动预览；真实正文引用保留。Base 查询/卡片不算使用；动态目标、损坏文档、缓存未就绪/过期及解析歧义保守 unknown。

删除分 metadata-only 和 pair，两者保护索引入链与人工保留；pair 另外保护原附件使用、范围与唯一关联。受保护项跳过并展示原因；无强制批量绕过。

执行必须由明确确认发起：预览路径与正文警告 → 确认后重新扫描、核对代次/指纹/未保存编辑 → 每一对再次检查 → 原附件先进入本地 .trash → 索引后进入 .trash。部分失败记录准确步骤；不永久删除、不删除父目录、不保存用户笔记、不自动重试/恢复/续删。事务日志在配置目录持久保存，初始日志无法保存时不开始删除。

## 验证与部署

执行 npm ci、npm run pipeline、独立文件策略测试、git diff --check；覆盖率四项至少 90%，不排除新增模块。保留原 PDF/i18n 场景，替换旧破坏性行为断言。

本地部署先建 0700 备份并记录哈希，只复制 main.js/manifest.json/styles.css，不覆盖 data.json。通过 CLI 发现新清单、启用并定向重载，不以整应用重载代替。运行验收只创建唯一 ALP_QA 命名空间，旧材料做只读核对；主 Base 显式升级先备份。二次重载核查重复按钮/视图、原文哈希、设置与恢复记录。实际 MarginNote 页面定位由人工终验，不能以分发调用冒充成功定位。
