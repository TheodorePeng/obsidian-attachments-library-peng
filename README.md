# Attachments Library Peng

基于 José Compadre Junior 的 [Attachments Library](https://github.com/compadrejunior/attachments-library) 开发的 Obsidian 附件索引与画廊插件。当前版本 **1.6.0**，插件 ID 为 `attachments-library-peng`，最低 Obsidian 版本为 `1.13.1`。1.6.0 的隔离运行验收使用 macOS 上的 Obsidian 1.13.7，已发布为 GitHub Release，可通过 BRAT 安装或更新。

附件保存在原位置，配套的普通 Markdown 索引承载 Properties、OCR 和说明。使用原生 Bases 查询与插件画廊管理这些索引。

## Install via BRAT / 通过 BRAT 安装

**English** — Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, then open **Settings → BRAT → Beta plugins → Add Beta plugin** and enter:

- Repository: `TheodorePeng/obsidian-attachments-library-peng`
- Plugin ID: `attachments-library-peng`

BRAT installs the plugin from the latest GitHub Release of that repository. Every release ships three assets — `main.js`, `manifest.json` and `styles.css` — and BRAT downloads all three. To move to a newer version, use **Update** in the BRAT settings and reload the plugin. BRAT's behaviour can change over time, so confirm the current procedure in the [official BRAT repository](https://github.com/TfTHacker/obsidian42-brat) and the [BRAT developer guide](https://tfthacker.com/brat-developers).

BRAT reads the release list through the GitHub API. For a public repository, anonymous requests are limited to 60 per hour per IP, so BRAT can briefly report `GitHub API rate limit exceeded`. Setting a **Personal access token** in the BRAT settings raises that limit.

**中文** — 先安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，然后打开 **设置 → BRAT → Beta 插件 → 添加 Beta 插件**，填入：

- 仓库地址：`TheodorePeng/obsidian-attachments-library-peng`
- 插件 ID：`attachments-library-peng`

BRAT 会从该仓库的最新 GitHub Release 安装插件。每个 Release 提供 `main.js`、`manifest.json` 和 `styles.css` 三个资产，BRAT 会一并下载。升级到新版本时，在 BRAT 设置里点更新并重载插件。BRAT 的行为会随版本变化，请以[官方仓库](https://github.com/TfTHacker/obsidian42-brat)和 [BRAT 开发者指南](https://tfthacker.com/brat-developers)为准。

BRAT 通过 GitHub API 读取 Release 列表。公开仓库的匿名请求按 IP 每小时只有 60 次，必要时会出现 `GitHub API rate limit exceeded` 提示；在 BRAT 设置的 **Personal access token** 里填入令牌即可提高额度。

## 设置入口

设置页按 Gallery、Indexing、Existing library、Image interaction、Maintenance & recovery 组织。

1. **Gallery** 以状态卡显示当前 Base 完整路径、默认视图与连接状态。**Connect gallery… / Change…** 打开一个连接对话框，文件与视图一次提交；取消保留原连接。
2. **Existing Base** 支持任何名称、位置和创建来源的合法 Base。只要有当前插件的兼容视图即可连接；创建标记不是资格证明。多个视图可在同一对话框选择。没有兼容视图时，**Add gallery view…** 先预览，再明确备份添加，保留原筛选、名称及其他视图。
3. **New Base** 与已有文件表单互斥，在 Vault 根目录创建默认 `Attachments Library.base`，可修改文件名。**Create and connect** 成功后才替换原连接；同名文件不覆盖。文件创建后连接保存失败会显示新文件路径，供重新选用，不自动删除或复制。
4. 状态卡的 **Open gallery** 只打开所选文件及视图。**More… → Disconnect** 只取消连接。文件丢失、配置损坏和视图变化都有 **Fix connection…** 入口，不自动重建文件。
5. Gallery 连接、新索引位置、Base 筛选是三个独立概念。已有 Base 的筛选不自动改写；例如仍筛选 `Library/旧目录` 的画廊不会显示新目录中的索引，这并不表示连接失效。

**New index notes folder** 是新 Markdown 索引的输出目录。输入和文件夹候选选择只改变草稿，**Save location** 保存，**Cancel changes** 取消；关闭设置页丢弃未保存草稿。保存反馈和错误就地显示，失败时保留输入并说明旧位置仍生效。不要把 `Gallery.base` 填入目录字段：该字段需要文件夹，例如 `资料/附件索引`。不存在的目录只在首次创建索引时建立。

**Entire Vault** 模式隐藏 Attachment folder；切回文件夹模式恢复已保存目录。Base 和索引目录及其父目录在 Obsidian 中移动后自动跟踪；插件停用期间的移动通过手动选用或重新发现恢复。

新索引直接平铺到目标目录，例如附件 `Attachments/课程/图片.png` 对应 `Library/图片.png.md`。同名时依次使用 `图片.png (2).md`、`图片.png (3).md`，保留完整附件路径作为关联依据，不覆盖普通笔记。已有索引保留原位置，不重复创建；附件改名更新关联和受控预览，不移动索引。索引目录及其父目录在 Obsidian 中移动后跟踪更新设置。

索引使用独立目录，不能选择 Vault 根目录、隐藏/配置目录、附件范围的祖先目录，或包含参与管理原附件的目录。相对路径支持中文和空格；桌面端也接受当前 Vault 内可核对的绝对路径，并转换显示为相对路径。Vault 外路径不接受。扩展名白名单始终禁止 Markdown 及其变体、Base 和 Canvas。

新安装默认开启 **Create indexes for new attachments**；已有安装保留原来的有效开关值。自动创建从初始化完成后开始，只处理以后新增、包括同步到库的合格附件。开关开启不补建历史文件，也不要求先创建 Base；历史附件通过 **Scan attachments…** 明确预览补建。关闭会取消尚未执行的自动创建任务，已创建索引保留。

扫描预览显示分配好的目标路径。同一批次的同名附件使用不同目标；预览后目录、附件身份或目标占用变化时，跳过受影响项并要求重新预览。

## 三条命令

| Command | 用途 |
|---|---|
| Open attachment gallery | 只打开设置中的默认 Base 和视图，复用匹配标签或新开标签 |
| Update current attachment… | 更新当前原附件、索引或笔记光标处的附件；不唯一时提供选择器 |
| Scan attachments… | 选择配置范围或其中的文件夹，预览补建和必需字段修复 |

普通更新按范围处理目标，并增量更新引用缓存。维护页的 **Rebuild reference index** 用于明确的完整重建。引用安全检查始终覆盖整个 Vault。

旧独立刷新、混合配置整理命令已移入 Maintenance；绑定过被移除命令的快捷键需要手动重绑。

## 属性

新索引的业务属性只有三个：

| 属性 | 类型 | 含义 |
|---|---|---|
| attachment | Text / Wikilink | 插件维护的完整附件路径 |
| url | Text | 用户填写的 HTTP(S) 或应用跳转地址 |
| keep | Checkbox | 保护原附件、索引及其中的 OCR、说明 |

另有五个系统属性：`_filePath`、`_fileType`、`al_schema`、`al_usageCount`、`al_usageState`。新协议为 `al_schema: 2`；引用字段是磁盘快照，实时完整度见引用详情及删除预览。

`source`、`tags`、作者等按需自行添加。例如 `source: MarginNote` 表示出处名称，实际跳转地址写入 `url`。插件不生成书籍元数据模板、不自动提取 PDF 作者标题，也不重置自定义属性。

原生类型登记只涉及八个必需字段；同名全 Vault 类型或现有值有冲突时，设置页列出受影响文件。必需保留字段损坏时维持保护，通过更新预览和 Properties 修复。

## 重新接管已有资料

Schema 1／2 索引在任意位置均可识别，不依赖某次安装或旧 `data.json`。重装后重新连接已有 Base 即可。当前输出目录不限制旧索引身份，也不会搬迁文件。

**Existing library → Restore existing library…** 只读发现兼容 Base、可携带索引、未标记旧候选及冲突。旧候选必须同时具备一致的 `_filePath` 和附件链接；用户勾选、预览并确认后，先备份，再只补 `al_schema: 1`。正文、OCR、自定义属性、保护状态和位置保留。重复关联、未知 schema、保护字段损坏等不自动接管。

存在可信旧索引候选时，自动创建会保护该附件，避免重装后生成重复索引。普通笔记不会只因所在文件夹而变成索引。

## 旧索引迁移

通过 **Maintenance & recovery → Migrate index properties…** 选择当前索引、文件夹或全部已识别索引，先检查差异，再确认备份和迁移。

- 旧 `source` 地址迁入 `url`，`al_keep` 兼容迁为 `keep`。
- 有意义的旧标题、非默认阅读状态追加到正文末尾的 **Legacy metadata**；原 OCR 和说明保留。
- 旧模板空字段可以选择清理。Schema 2 文档中用户新加的同名属性保持原样。
- Base 依赖不明确、配置损坏或新旧用途混用时，保留旧字段，并列出需人工复核的 Base。

未确认迁移前，旧 URL 和保留标记继续生效。Math Peng 的既有材料没有执行批量迁移。

## 图片与安全管理

图标位于图片右侧居中，默认自动隐藏。普通点击打开索引；Command/Ctrl 点击默认打开 `url`，也可在设置中选择索引新标签。Command 悬浮图标或画廊名称时预览索引 Markdown，Hover Editor 可接续处理。

卡片更多菜单中的“仅删除索引”保持原附件与其他文档不变；有外部索引引用时仍受保护。“删除附件及索引”先生成一个完整预览，列出回收目标、所有来源修改、阻塞原因及准确的修改前后内容。

确认 **Remove references and move to trash** 后，移除匹配的 Markdown／Wiki 嵌入；普通链接保留标签或文件名文字；YAML 列表只移除匹配项，纯链接标量清空；Canvas 文件/本地链接节点和关联边一并移除，文本节点只清理引用，分组只清除背景；可定位的静态 HTML 图片/链接、Base 静态地址及直接来源属性按预览处理。保留其他正文、节点、边、属性和代码/数学/注释。

设置 URI、无资源地址的 HTML 占位文字及常见 Base 公式不会被误认为全库附件引用。重复的普通 YAML 键都会参与引用扫描；重复的身份或保护字段保持冲突保护。无法可靠定位/修改的动态引用、未知来源、keep、重复索引、相关未保存编辑、待提交卡片草稿仍阻止执行。多选包含阻塞项时整批不执行，不静默跳过。

执行前重新验证快照，先建立 Vault 外二进制及源文档备份和持久化阶段记录，再逐文件修改、重新扫描，最后移到 Vault 本地 `.trash`。本流程不执行永久删除，也不宣称跨文件系统原子性。中途失败先恢复原目标，再按内容条件恢复引用；不覆盖后续用户编辑。发生冲突时显示 **Recovery required**，保留备份。

原生 Cards、表格和 CMS 的自带删除按各自行为执行；成对删除请使用本插件明确标记的安全入口。

## 恢复与验证

迁移、类型登记和修复的私有备份及报告位于 `~/.local/share/attachments-library-peng/backups`（目录 0700，文件 0600）。最近操作摘要及恢复位置保存在插件设置中，重载后可查看。**Maintenance & recovery → Recovery records…** 列出本 Vault 的删除记录与未完成任务。**Review restoration…** 明确确认后恢复，路径占用、内容变化和备份完整性异常会受到保护。回收站副本和私有备份不自动清理。

备份仅存本机，不随 Vault 同步。恢复文件包含原始二进制、索引及被修改的引用文档；其他迁移操作继续使用各自报告。桌面能力延迟加载；移动端缺少等效持久化备份时禁用回收执行，普通浏览与设置保留。真实移动设备尚未验收。

```bash
npm ci
npm run pipeline
node --experimental-strip-types --test tests/file-policy.acceptance.mjs tests/base-formulas.acceptance.mjs tests/gallery-config.acceptance.mjs tests/target-selection.acceptance.mjs
git diff --check
```

- [1.6.0 设置、接管与可恢复删除验收](docs/acceptance-1.6.0-2026-11-14.md)
- [1.5.0 设置与索引创建验收记录](docs/settings-indexing-acceptance-2026-11-14.md)
- [1.4.0 实施约定](docs/implementation-plan-1.4.0.zh-CN.md)
- [1.4.0 验收、截图与恢复记录](docs/implementation-acceptance-1.4.0-2026-10-26.md)
- [1.3.0 及以前的 README 历史](docs/README-through-1.3.0.md)

保留原项目作者信息与 [MIT 许可](LICENSE)。1.6.0 已提交、推送并发布为 GitHub Release，BRAT 用户可直接安装或更新。
