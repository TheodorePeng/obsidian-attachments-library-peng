# Attachments Library Peng 1.3.0 本地实施与验收

日期：2026-10-25。源码和两个 Vault 均已安装 1.3.0。Git HEAD 保持 `10a127e77d66b73ced15b610a8019b96d05e1384`，未提交、推送或发布；插件 ID、最低版本声明 1.13.1 与 al_schema 1 保持不变。本次实际运行环境为 macOS / Obsidian **1.14.5**。

## 交付内容

- 四个插件管理模式统一为响应式画廊：完整本地图片封面、按需媒体预览、主题变量和紧凑工具栏。移除旧固定标题、说明、路径、状态与 Keep；分页按需显示并避让状态栏。
- 原生 Properties 驱动字段顺序、显隐与名称；保留 0 / false，默认隐藏空值。兼容旧 Base 的非前缀属性显示名，Math Peng 的 `Created` / `Source` 沿用原配置。
- 封面、空白和名称打开当前卡片的索引；Command/Ctrl 或中键新标签。名称通过独立标准悬浮来源预览索引，普通属性链接保留目标，原附件入口独立。
- 属性编辑服务支持文本、数字、日期、日期时间、字符串列表、布尔；字段级并发检查、未保存 Markdown/删除保护、正文保全、会话草稿与继续编辑。复杂/协议/派生/文件/公式字段保持只读。
- al_keep 是可选的正常布尔属性；隐藏后仍受保护。草稿存在也会阻止索引删除。沿用引用分析、影响预览、两种删除门禁、确认后核对与本地回收日志。

实现集中于 `library-view.ts`、`gallery-config.ts`、`gallery-options.ts`、`gallery-policy.ts`、`gallery-hover.ts`、`property-edits.ts`、`property-editor.ts`。Main 管理共享服务和组件清理；BasesCreator 原子补齐缺失 order；DeletionService 仅增加未提交编辑保护。附件白名单、引用解析和笔记图片导航模块未被改写。

## 源码检查

| 检查 | 结果 |
| --- | --- |
| npm ci | 成功，锁文件仅修改根项目版本，没有依赖升级 |
| ESLint | 成功；保留既有 Vault.trash 提示，本地 `.trash` 是明确要求 |
| Vitest | **245 / 245**，原基线 203 项的适用安全场景保留 |
| Statements / Branches / Functions / Lines | **95.84% / 90.85% / 93.36% / 98.40%** |
| TypeScript / esbuild | 成功 |
| 独立 Node 检查 | **41 / 41**：文件规则 14、Base 公式 15、画廊配置 12 |
| git diff --check | 成功 |

四项覆盖率阈值仍为 90%，未排除新增模块。日志位于持久工作目录：
`/Users/peng/Documents/Codex/alp130-recovery/final-{ci,pipeline,independent}.log`。npm ci 仍报告既有依赖链的 15 个审计项（2 low / 6 moderate / 7 high）；本次没有通过自动升级依赖来改变范围，也未将其称为安全审计通过。

执行前已通过 HYBRID 本地健康与 Git 检查，Git 未要求暂停。一个定型的纯配置辅助任务使用隔离 Worker，审查产物、补丁及独立验证后应用；其余架构、交互、编辑/删除集成和部署由 Codex 完成。

## 真实测试库

Vault：`/Users/peng/Documents/GitHub-Peng/Obsidian AI Coding`；Hover Editor **0.11.28**，未升级。
QA 命名空间：`ALP130_QA_20261025_160140`（图片、WAV、MP4、PDF、五份索引、Base、图片笔记及嵌入验收笔记）。

| 场景 | 现场结果 |
| --- | --- |
| 宽/窄布局 | 多列从左至右；360px 容器无水平溢出；没有旧标题、范围说明或固定 Keep |
| 原生 Properties | 原生菜单选入 al_keep 后出现对应属性；之后属性顺序改变即重绘，重载保留 |
| 封面/分页 | 关闭封面且隐藏全部属性时仍保留 48px 可点击卡片，点击打开正确索引；开关持久化；每页 2 项的实际翻页清空选择；按钮完整位于状态栏上方 |
| 普通/Command/中键导航 | 当前索引、索引新标签、索引新标签，均通过真实指针事件验证 |
| 名称悬浮 | 先按 Command、先进入再按 Command 均只新增索引窗口，完整延迟后目标仍正确 |
| 属性编辑 | 文本、42.5 数值、中文/内部链接/带逗号列表、URL、日期、带时区日期时间及布尔均保存成功 |
| 正文保全 | 多次属性编辑前后 OCR 正文完全相同 |
| 草稿 | 重绘、切换原生表格再返回后保留；对应索引的删除被保护 |
| 隐藏 Keep | 零业务引用、完整检查的附件仍因 al_keep 被保护，取消显示不会解除 |
| 媒体 | 图像、音频、视频和 PDF 通过独立预览入口加载；画廊中无成批播放器/iframe |
| 嵌入 Base | 阅读模式及 Live Preview 中均为 5 张可见卡片；缓存的隐藏渲染层不计为重复界面 |
| 重载/停用 | 两次定向重载后各 5 卡片、1 个活动视图；停用后画廊、属性浮层、图片按钮均为 0；启用并等待 ready 后恢复 |

### 删除与恢复

- 通过画廊的选择 → 安全删除菜单 → 结构化预览 → 确认执行，完成一次真正的成对回收；先取消时两份文件保持存在。
- 仅针对 QA 的 orphan.png 和索引：日志事务 `9f315302-01d5-4abc-b640-f2d584ba1166` 显示先附件、后索引、complete。随后从实际 `.trash` 中按哈希匹配复制恢复，附件和索引均与回收前哈希一致。
- 对被图片笔记直接使用的 QA 图.png，预览显示 1 个业务来源、原图两处嵌入行号、索引入链 0；“仅删除索引”成功且原图仍在。索引再从实际 `.trash` 按哈希恢复。
- 测试库既有 6 份来源（1 份 Copilot 模板、4 份 ScreenTime Chat、1 份 Eudic 笔记）含无法限定目标的 HTML/应用链接，按既有保护机制会阻塞清理。为真实成功验收，先单独备份，仅把这些来源的正文暂时包为代码示例，保留 frontmatter/UUID，使用原子内容核对；验收后 6 份均恢复原始字节/哈希。未放宽产品门禁，未关闭其他插件。
- 来源恢复后，未知引用仍可能阻止清理，这是保守保护，不以“无回链”绕过。测试材料及回收副本保留，未清空回收站。

## Math Peng 共存与数据检查

Vault：`/Users/peng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Math Peng`；Hover Editor **0.11.31**，未升级。
主库仍为根目录 **Attachments Library.base**，打开归属标记对应的 **All attachments**（旧名称原样保留）。当前原生查询 32 条，实际附件索引 **31** 张；普通 Library 文档不变成附件卡片。

- 原生 **All Attachments** Cards、**Unread** 表格、**View** CMS、新画廊逐一切换，均呈现对应的原生/插件 DOM。未修改 CMS 配置或私有选择状态。
- 新画廊实际利用横向空间，1600px 验收视口下为 5 列；缩略图使用完整显示。
- 使用既有 `ALP_QA_20261024_005324` 材料验证两种 Command 名称悬浮，只打开对应索引。
- 既有笔记图片按钮在阅读与 Live Preview 模式均复核索引悬浮；原图片导航源码未修改。没有把画廊 Command 点击误用为出处跳转。
- 部署前 1,409 份 Markdown / Base / Canvas 基线无漂移；验收后 **1,408 份完全一致**。唯一预期变更为主 Base：四个插件自有视图各增加文件名/创建时间/出处的缺失 order。没有改写学习笔记、OCR、自定义属性或附件，也未执行全库补建或删除学习材料。
- 配置按 YAML 对象逐项比对：原全局筛选、原生视图、CMS、名称、排序、分组和属性定义均一致。运行验收中出现过一个空的 QA 临时 View 2，已在保存副本后按精确结构清理；重复打开库不再新增视图。其成因仅定位到本次打开/重载时序，未把它归因于用户配置。

原 Base 备份：
`/Users/peng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Math Peng/Attachments Library.base.alp-gallery-backup`。该副本与部署前基线一致；升级重复执行不会增加重复视图。

## 活跃构建与恢复

两个 Vault 均只复制 main.js / manifest.json / styles.css 并定向重载，产物 SHA-256 与主源码构建一致；data.json 未覆盖（现场原本均不存在）。未全应用重载，未改变 Hover Editor、CMS 或同步/发布设置。

| 产物 | SHA-256 |
| --- | --- |
| main.js | 2d00bf7efb56385efc1a409e409ee978305bbd4952da2fa9ed8eeb3a622f1f01 |
| manifest.json | aa2143b3fa31435d076e0a82a67456a6efbd29d45cf09af7568323ec8e908635 |
| styles.css | 1ea21a55a559af42f9b329999c2dc8da8f88327ec05c70b65d16c55600a3d197 |

持久恢复与证据目录（权限 0700）：
`/Users/peng/Documents/Codex/alp130-recovery/`。

- `backup/math/` 保存升级前 1.2.0 产物、Base 与文档基线；`backup/test/` 保存本次继续前测试库状态。
- `temporary-sources/` 保存 6 份来源原始/临时内容、恢复哈希清单。
- `delete-targets/` 和 `evidence/pair-restore.json` / `metadata-delete-restore.json` 保存回收目标哈希与实际恢复位置。事务日志仍位于测试 Vault 的 `.obsidian/plugins/attachments-library-peng/deletion-log.json`。
- `evidence/final-integrity.json` 保存文档比对和两库产物哈希；各 `*-results.json`、运行日志与截图记录真实交互。
- 早期系统临时工作树/备份被系统清理后，源码与测试从本会话操作记录恢复到持久目录，并重新执行完整检查；最终源码已整合回原项目路径。回滚前必须核对当前文件仍为本次产物/配置，保留用户后续修改；不自动执行回滚或 Git 历史操作。

实际界面：[Math Peng 画廊](/Users/peng/Documents/Codex/alp130-recovery/evidence/math/gallery-math-final.png)、[属性编辑后的测试画廊](/Users/peng/Documents/Codex/alp130-recovery/evidence/gallery-properties.png)、[删除预览](/Users/peng/Documents/Codex/alp130-recovery/evidence/delete-preview.png)、[真实删除结果](/Users/peng/Documents/Codex/alp130-recovery/evidence/pair-delete-result.png)。

## 现场发现与修复、范围限制

真实运行补获并修复了构造期间 config 尚未就绪、误用通用 get 读取 order、Value.renderTo 的内部链接上下文缺失、插件停用时原生持有的画廊组件未清理、分页被状态栏遮挡及旧属性显示名兼容问题，均补相应行为回归或真实布局复核。诊断日志保留旧异常，不把历史错误当作最终仍在发生；没有清空用户诊断记录。

本次实际覆盖 macOS / Obsidian 1.14.5；更低版本、Windows、移动端/触屏和大量附件的长期性能未作同等级现场验收。未生成 PDF 缩略图、视频截图、远程封面或 OCR。草稿为当前插件会话内存，停用后不保留为磁盘文件。MarginNote 的具体页面定位不属于本轮画廊实现验收。
