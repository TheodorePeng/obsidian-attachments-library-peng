# 英文界面、附件目录范围与 Keep 解锁验收（1.6.1，2026-11-14）

实现版本为 1.6.1，随 1.6.1 GitHub Release 发布，通过 BRAT 从 `TheodorePeng/obsidian-attachments-library-peng` 安装或更新。

本轮**未做隔离运行验收**，也**未部署到任何 Vault**；下面的证据全部来自自动化门禁。1.6.0 的隔离运行验收记录见 [acceptance-1.6.0-2026-11-14.md](acceptance-1.6.0-2026-11-14.md)。

## 最终行为

- **界面全量英文。** 设置页、画廊卡片、图片导航与悬浮角标、删除预览、引用详情、恢复对话框、Bases 视图选项全部改为英文文案。Bases 视图注册名从「附件画廊（Peng）」改为 `Attachment gallery (Peng)`。
- **附件目录范围。** `Index scope` 切换前先校验，失败时保持原范围并在就地反馈里说明原因；`Attachment folder` 是独立的草稿 / **Save location** / **Cancel changes** 控件，带文件夹候选，关闭设置页丢弃未保存草稿。附件目录在 Vault 内被移动或改名后，设置自动跟随。索引目录在搜索附件时按范围排除。
- **新安装的默认位置。** 默认 Base 文件名从 `Attachments Library.base` 改为 `Attachment Index.base`；新安装的默认索引目录改为 Vault 根目录下的 `Attachment Library`。已有安装保留已保存的位置，旧配置缺少该字段时继续使用 `Library`。
- **Keep 保护下的删除。** 被 `Keep` 阻止的索引在删除预览里说明原因，并提供 **Turn off Keep…**：它关闭该索引的 `keep` / `al_keep`、重新检查删除计划，且删除本身仍需单独确认。
- **更清楚的删除预览。** 被阻止的条目按具体原因分类提示（Keep 开启、Keep 设置冲突、待保存的编辑、索引冲突、找不到唯一索引、引用检查不完整、索引被其他文档引用、超出附件范围、仅桌面端可删、无法安全移除的引用、文档未保存）；文件与引用详情收进可展开的 “Files and reference details” 分区。
- **删除结果文案。** Moved to trash / Nothing was deleted / Deletion stopped / Changes were restored / Recovery required 各自有独立标题；`Recovery required` 可直接打开恢复记录。

## 自动化证据

门禁命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 problems |
| `CI=true npm run test` | 通过，39 个测试文件、369 项测试 |
| `npm run test:coverage` | 通过，阈值门禁（90%）满足 |
| `npm run build` | 通过，`tsc -noEmit -skipLibCheck` 与 esbuild 生产构建均无错误 |
| `node --experimental-strip-types --test tests/*.acceptance.mjs` | 通过，4 个脚本共 57 项测试 |
| `git diff --check` | 通过 |

覆盖率：

| 覆盖率 | 结果 |
| --- | --- |
| Statements | 95.46% |
| Branches | 90.03% |
| Functions | 94.11% |
| Lines | 98.99% |

构建产物：`main.js` 728182 字节（sha256 `75ec3443881294e564fd7f1797a702a0ae1f6d51691ad075e4083cc2e00cda91`）。`main.js` 不入库，仅作为 Release asset 上传；`styles.css` 与 1.6.0 逐字节一致（sha256 `e20af92ac791e54bde79cf0396a859a9ab13418e558dbe4e31f42c4db83e7f34`）。

新增与调整的测试覆盖：附件目录范围设置（`tests/settings.test.ts`、`tests/interaction-v161.test.ts`）、路径规划与校验（`tests/path-planning.test.ts`）、删除预览与阻止原因分类（`tests/dialogs-v160.test.ts`、`tests/cascade-v160.test.ts`）、Keep 解锁与保护判定（`tests/keep-v140.test.ts`）、属性编辑与画廊交互（`tests/property-edits.test.ts`、`tests/gallery-ui.test.ts`）。

## 数据变化与验证边界

- 本轮**未部署到任何 Vault**，未触碰主 Vault 或测试 Vault，未创建、修改或删除任何用户数据。
- 本轮**未做隔离运行验收**：真实 Obsidian 界面下的英文文案渲染、附件目录候选交互、**Turn off Keep…** 的完整点击路径、移动端表现均**未经真实运行验证**，仅有自动化覆盖。升级到 1.6.1 后建议先在测试 Vault 复核这三项。
- 兼容性：升级用户已保存的索引目录不会被新默认值覆盖（`settingsFromSaved` 仅对全新安装套用 `Attachment Library`），旧配置缺少该字段时沿用 `Library`；`minAppVersion` 保持 `1.13.1`；`data.json` 由 Obsidian 与 BRAT 保留。
