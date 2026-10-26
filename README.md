# Attachments Library Peng

基于 José Compadre Junior 的 [Attachments Library](https://github.com/compadrejunior/attachments-library) 开发的 Obsidian 附件索引与画廊插件。当前版本 **1.4.0**，插件 ID 为 `attachments-library-peng`，最低 Obsidian 版本为 `1.13.1`。本轮运行验收使用 macOS 上的 Obsidian 1.14.5。

附件保存在原位置，配套的普通 Markdown 索引承载 Properties、OCR 和说明。使用原生 Bases 查询与插件画廊管理这些索引。

## 设置入口

设置页全部使用英文，分为 Gallery、Indexing、Managed properties、Image button、Maintenance。

1. 在 **Gallery → Default base file** 选择任意名称的 `.base` 文件。
2. 在 **Default view** 选择该文件中的附件画廊视图。Base 尚无画廊时，先使用 **Maintenance → Repair gallery views** 预览并添加；已有表格、Cards、CMS、筛选和名称保留。
3. 也可以使用 **Create base…** 明确创建一个新文件，再打开画廊。

默认 Base 设置只决定打开命令的目标。其他 Base 可以各自添加插件画廊，使用独立的查询、排序、分组和 Properties 配置。Base 筛选条件与附件索引范围分别设置。

**Entire Vault** 模式隐藏 Attachment folder；切回文件夹模式会恢复已保存的目录。**Index notes folder** 只影响新索引位置，已有索引保留原位置。扩展名白名单始终禁止 Markdown 及其变体、Base 和 Canvas。

新安装默认关闭自动索引。开启 **Create indexes for new attachments** 后，只处理以后新增的附件，无需先进行全库补建。

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

## 旧索引迁移

通过 **Maintenance → Migrate index properties…** 选择当前索引、文件夹或全部已识别索引，先检查差异，再确认备份和迁移。

- 旧 `source` 地址迁入 `url`，`al_keep` 兼容迁为 `keep`。
- 有意义的旧标题、非默认阅读状态追加到正文末尾的 **Legacy metadata**；原 OCR 和说明保留。
- 旧模板空字段可以选择清理。Schema 2 文档中用户新加的同名属性保持原样。
- Base 依赖不明确、配置损坏或新旧用途混用时，保留旧字段，并列出需人工复核的 Base。

未确认迁移前，旧 URL 和保留标记继续生效。Math Peng 的既有材料没有执行批量迁移。

## 图片与安全管理

图标位于图片右侧居中，默认自动隐藏。普通点击打开索引；Command/Ctrl 点击默认打开 `url`，也可在设置中选择索引新标签。Command 悬浮图标或画廊名称时预览索引 Markdown，Hover Editor 可接续处理。

本插件的安全删除入口提供“仅删除索引”和“删除附件及索引”，展示引用、全部关联、保留原因及实际回收文件。`keep`、关联冲突、引用检查不完整、未保存编辑和属性草稿都参与保护；隐藏属性不改变保护。文件进入 Vault 本地 `.trash`。

原生 Cards、表格和 CMS 的自带删除按各自行为执行；成对删除请使用本插件明确标记的安全入口。

## 恢复与验证

迁移、类型登记和修复的私有备份及报告位于 `~/.local/share/attachments-library-peng/backups`（目录 0700，文件 0600）。最近操作摘要及恢复位置保存在插件设置中，重载后可查看。桌面恢复能力延迟加载；移动端迁移与恢复尚未验收。

```bash
npm ci
npm run pipeline
node --experimental-strip-types --test tests/file-policy.acceptance.mjs tests/base-formulas.acceptance.mjs tests/gallery-config.acceptance.mjs tests/target-selection.acceptance.mjs
git diff --check
```

- [1.4.0 实施约定](docs/implementation-plan-1.4.0.zh-CN.md)
- [1.4.0 验收、截图与恢复记录](docs/implementation-acceptance-1.4.0-2026-10-26.md)
- [1.3.0 及以前的 README 历史](docs/README-through-1.3.0.md)

保留原项目作者信息与 [MIT 许可](LICENSE)。当前为正式发布的 1.4.0 版本。
