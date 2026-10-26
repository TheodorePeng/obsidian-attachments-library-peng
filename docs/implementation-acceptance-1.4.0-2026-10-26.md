# Attachments Library Peng 1.4.0 验收记录

日期：2026-10-26（Asia/Shanghai）。源码位于 `/Users/peng/Documents/GitHub-Peng/ObsidianPlugins-Peng/obsidian-attachments-library-peng`。本轮没有提交、推送或发布。

## 交付范围

- 新索引使用 attachment、url、keep 和五个系统字段，`al_schema: 2`；不再生成整套书籍元数据。用户自定义属性保留。
- 新旧 URL、保留标记通过统一访问层兼容；类型或保留值无效时维持保护。原生类型适配器仅登记八个受管字段，冲突只报告。
- 后台派生字段与附件重命名也检查未保存编辑和并发关联变化，不覆盖编辑器草稿或新关联。
- Base 配置损坏、动态属性名或循环结构无法可靠确定依赖时，保留旧字段并报告人工检查；固定属性引用按大小写不敏感识别。
- 提供显式的迁移差异、私有备份、内容指纹和未保存编辑检查；非默认旧标题/阅读状态追加到 Legacy metadata，原 OCR/正文保留。
- 设置页重组为五个英文分组；明确默认 Base 完整路径及视图。无画廊的 Base 可以先绑定，再明确修复。旧目录兼容只查找现有文件。
- 命令为 Open attachment gallery、Update current attachment…、Scan attachments…。当前附件和文件夹操作保持目标范围；常规刷新使用脏文件队列及缓存。
- 默认 Base 移动可跟踪，删除后不自动重建。打开命令复用匹配的标签，否则新开标签；显式加载 deferred Base，不替换正在编辑的笔记。
- 插件重载重新连接已打开的插件画廊。最近操作摘要及恢复位置随插件设置保存，重载后恢复。
- 更改索引目录不批量写入旧索引；已识别旧索引位置通过设置保留。Markdown 永不成为附件候选，大小写不同的 Markdown/Canvas 引用也纳入检查。

## 源码检查

| 检查 | 结果 |
|---|---|
| npm ci | 通过；使用锁文件依赖 |
| npm run lint | 通过，0 错误、3 警告 |
| npm run test:coverage | 294 项通过，33 个测试文件 |
| 语句覆盖率 | 96.27% |
| 分支覆盖率 | 91.28% |
| 函数覆盖率 | 94.98% |
| 行覆盖率 | 98.90% |
| npm run build | TypeScript 检查及生产构建通过 |
| 独立 Node 检查 | 57 项通过：附件规则、Base 公式、画廊配置、目标选择 |
| git diff --check | 通过 |

覆盖率包含新增模块，没有为新增功能排除模块。测试从原有 245 项基线演进，替换了旧书籍模板、首次全扫描门禁和混合打开命令的过时断言，保留引用、删除与正文保护回归。

三项 lint 警告分别涉及：按产品约定固定使用本地 Vault trash；兼容现有 Obsidian 的 SettingTab display 接口；Node 内置方法解构的 this 静态提示。

一个纯目标选择辅助模块在隔离 Worker 中完成，审查代码、报告、结果和独立检查后通过 Runner 应用；关联协议、迁移、删除保护、设置、命令和部署由 Codex 实现及验证。

## 活跃构建

| 项目 | 值 |
|---|---|
| 插件 ID | attachments-library-peng |
| 插件版本 | 1.4.0 |
| 最低 Obsidian | 1.13.1 |
| 现场 Obsidian | 1.14.5 / macOS |
| main.js SHA-256 | `566a4605fa7431363a7b87247f4db3372d81e848eb1f8ccf881facc3370c4c92` |
| manifest.json SHA-256 | `242c3116ff903339f8102c4fcdf9b4fab73c0959f41f1fd7198d3b7f5366e68b` |
| styles.css SHA-256 | `1ea21a55a559af42f9b329999c2dc8da8f88327ec05c70b65d16c55600a3d197` |

两个 Vault 的三个安装产物与源码构建逐文件哈希一致。每次部署只复制这三个文件，data.json 保留；测试中明确选择默认 Base 等操作才通过插件保存设置。

已通过 CLI 定向重载、再次重载、运行时服务/视图检查核对活跃构建，没有使用全应用重载。后台 deferred Base 本来不产生卡片实例；此前可见窗口验收中，打开命令实际加载并激活目标后，测试库 7 张、Math Peng 31 张卡片，重复打开复用同一标签。最终安全修正构建定向重载后曾因 Mac 锁屏暂停可见窗口复核。用户解锁后，两库 document.visibilityState 均为 visible；打开指定画廊分别显示 7 张、31 张卡片，均送达查询数据，重复打开复用同一标签，最终复核通过。测试创建的额外标签已关闭，保留原目标标签。

## 测试库：Obsidian AI Coding

Vault：`/Users/peng/Documents/GitHub-Peng/Obsidian AI Coding`。
QA 命名空间：`ALP140_QA_20261026_064800`。

| 场景 | 实际结果 |
|---|---|
| 当前原附件命令 | 预览确认后仅创建当前索引；新文件恰有 8 个规定字段 |
| 热缓存读文件范围 | 包裹 cachedRead 记录显示仅读取该附件自己的索引 Markdown，没有读取无关笔记 |
| 文件夹扫描 | 只补建 folder/scoped.png，其他目录中的 pair.png 当时仍未索引 |
| 笔记光标目标 | 两个嵌入中选中第二行，准确定位 keep.png；普通笔记没有被索引 |
| 未来附件自动索引 | initialScanComplete 仍为 false，明确启用后新增一个附件，只增加一份索引；测试后恢复关闭 |
| 任意 Base 选择 | 完整嵌套路径 Custom attachments.base 和 QA gallery 通过原生选择器保存 |
| 仅有原生视图的 Base | 文件先绑定、内容不变；明确确认修复后保留原表格和筛选，追加四个管理视图 |
| 创建 Base | 通过产品路径输入及确认流程创建 Created gallery.base，包含 schema 2 查询及新默认列 |
| Base 重命名 | 默认路径随重命名跟踪，内容不变，随后恢复原名 |
| 默认 Base 被删除 | 打开操作提示缺失，没有自动重建；从 .trash 恢复后核对哈希 |
| 迁移取消 | 原文件完全不变 |
| 有 Base 依赖的迁移 | URL、keep 和自定义值正确；依赖旧字段明确保留并提示人工处理 |
| 无依赖的迁移 | 实际迁移 prodrafts:// 测试值；旧标题/status 进入 Legacy metadata，原 OCR、中文说明、自定义字段保全 |
| 原生类型 | 八个必需类型登记成功；人为 keep 字符串冲突前后均被报告，值和已登记类型均未覆盖 |
| 自定义属性 | source=MarginNote、中文 tags 保留；url 可通过属性编辑服务保存 |
| 隐藏 keep | 原生 Properties 配置隐藏后卡片不显示该属性，删除仍受 keep 保护，原因明确包含 keep |
| 成对删除 | 产品影响预览显示 0 业务来源、完整检查、OCR 提示和两个目标文件；确认后均进入本地 .trash |
| 仅删除索引 | 原图有 1 个真实业务来源，仍允许只回收无入链的索引，原图留在原位 |
| 缓存新鲜度 | 新笔记缓存尚未就绪时，确认按钮禁用；取消并待缓存就绪后重新预览成功 |
| 删除取消与恢复 | 取消时文件保留；成对删除的原图和索引、单独删除的索引均从 .trash 恢复，哈希/完整内容核对通过 |
| 图片 URL 分发 | Command 点击实际读取 canonical url，分发到 https://example.com/alp140；测试拦截外部打开以核对目标 |
| Hover Editor 0.11.28 | 阅读模式图标先按 Command/后按 Command 均得到单个 Markdown 悬浮目标，内容路径为配套索引 |
| 设置 UI | 五组英文；Entire Vault 隐藏 Attachment folder，切换文件夹模式恢复该输入及原值 |
| 停用/再启用 | 停用后旧控制器、按钮和包裹均清除；启用后恢复一个可见图片入口，引用缓存就绪 |
| 二次重载 | 画廊恢复；无重复卡片实例；最近操作报告重载后保留 |

### 临时干扰源与恢复

已有 HTML 资源及本地应用链接令引用范围不确定，产品保持 unknown 和保护。为完成真实成功删除与无依赖迁移，按已批准的测试计划，将 8 个必要来源暂移至私有目录；检查过未保存编辑，逐文件记录哈希，未放宽产品门禁。

所有来源已恢复。欧路插件在笔记恢复后曾重写 red.md 的关联属性及一份引用笔记时间戳；正文未变。已先备份这些附带变化，再以内容指纹及未保存编辑检查恢复原文。未修改欧路插件设置，也未调用其同步或发布命令。最终 215 个测试前既有文件的哈希均与基线一致。

新增测试材料保留在上述 QA 命名空间及 `Library/ALP140_QA_20261026_064800`，共 20 个活动文件。类型冲突测试笔记在本地 .trash 中可恢复。完整新增清单见证据目录 final-vault-integrity.json。最终核对还观察到 Writing 目录下 4 个非本轮 QA 新文件，未修改或清理。

## Math Peng：既有材料与共存

Vault：`/Users/peng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Math Peng`。

- 默认 Base 为根目录 `Attachments Library.base`，默认视图通过归属标记定位到 `All attachments`。
- 原生 `All Attachments` Cards、`Unread` 表格、CMS 的 `View` 与插件画廊实际切换成功，原配置和名称保留。
- Hover Editor 0.11.31 的现有 QA 图片图标生成单个 Markdown 悬浮目标，路径为对应 Library 索引。
- 对一份既有学习索引完成只读迁移预览，显示旧字段/Base 依赖；文件未写入。
- 未执行学习材料真实迁移、全库补建或删除；未登记或覆盖 Math Peng 的全 Vault 类型。
- 最终 1495 个既有非隐藏文件（含主 Base、文档和附件）哈希一致，没有缺失。本轮没有新增 Math Peng 学习材料；核对时另观察到 4 个非本轮命名空间的新文件，未修改或清理。

## 截图与证据

- [英文设置页（测试库）](/Users/peng/Documents/Codex/alp140-implementation/settings-top.png)
- [默认 Base 设置（Math Peng）](/Users/peng/Documents/Codex/alp140-implementation/math-settings.png)
- [三条英文命令](/Users/peng/Documents/Codex/alp140-implementation/commands.png)
- [Math Peng 最终画廊](/Users/peng/Documents/Codex/alp140-implementation/math-gallery-final.png)
- [测试库最终画廊](/Users/peng/Documents/Codex/alp140-implementation/test-gallery-final.png)
- [成对删除影响预览](/Users/peng/Documents/Codex/alp140-implementation/delete-preview.png)

证据与部署备份根目录：`/Users/peng/Documents/Codex/alp140-implementation`，权限 0700。其中 predeploy/test、predeploy/math 保存安装产物、既有文档和哈希基线；active-build.json 保存完整构建哈希；final-pipeline.log、final-policy.log 保存检查结果；unlocked-gallery-check.json 保存解锁后最终视图及标签复用验证；qa-runtime-final.log、math-runtime-final.log 保存运行场景；pair-recovery.json、metadata-only-recovery.json、base-recovery.json 保存恢复核对；interference-manifest.json 和 interference-restored.json 保存暂移来源清单。

产品迁移/类型登记/修复的持久恢复目录为 `~/.local/share/attachments-library-peng/backups`。每次报告记录原路径、备份文件与 SHA-256；目录 0700，文件 0600。测试后不自动恢复整个旧 data.json 或 types.json，以免覆盖用户后续配置。

## 明确保留的人工事项

最后错误采集：Math Peng 无错误；测试库存在 ResizeObserver 提示，未出现本插件堆栈，尚未归因，不能将其表述为全应用零错误。
1. Math Peng 的真实字段迁移须由用户在产品预览中确认；安装本身不改写旧学习材料。
2. 检测到的 Base 字段依赖采用保留旧字段和人工复核；本轮没有自动改写混合用途的列、筛选或公式。解决依赖后，旧兼容字段的清理仍需人工核对。
3. URL 值、按钮路由和实际 Hover Editor 已验证；没有启动 MarginNote/ProDraft 实际页面定位，不将发出 URL 等同于定位成功。
4. 恢复后的测试库仍有既有 HTML/应用链接不确定性，受影响清理继续保持保护。移动端迁移、恢复及全平台编解码能力不属于本轮运行验收。

回滚前须比对当前哈希，只恢复仍属于本次部署的文件；保留之后的用户修改，不自动降级已被编辑的 schema 2 数据。部署前产物可在证据目录恢复，原附件/索引测试删除均已恢复。
