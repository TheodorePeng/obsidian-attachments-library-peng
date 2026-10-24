# Attachments Library Peng

独立的 Obsidian 附件管理插件，基于 José Compadre Junior 的 [Attachments Library](https://github.com/compadrejunior/attachments-library) 开发。插件 ID 为 `attachments-library-peng`，版本 `1.1.0`，最低 Obsidian 版本 `1.13.1`。保留原项目的 MIT 许可和作者信息。

附件原文件继续保存在 Vault 中；每份附件对应一份普通 Markdown 元数据文档。短字段放在 Properties，长篇 OCR、Markdown、LaTeX 和说明放在正文。插件不提供 OCR 服务，不下载远程图片，也不会修改图片、PDF 或其他附件的二进制内容。

## 开始使用

1. 将构建后的 `main.js`、`manifest.json`、`styles.css` 放入 `<Vault>/.obsidian/plugins/attachments-library-peng/`，在社区插件中启用 **Attachments Library Peng**。原 `attachments-library` 插件目录保持独立；同一 Vault 请只启用一个负责写入这组索引的版本。
2. 启动只读建立关联表和引用状态，**不会**自动创建 Base、补建索引或改写现有 Library 文档。
3. 在设置中选择全 Vault 或单文件夹范围，以及扩展名白名单。默认全 Vault，默认白名单包括图片、音频、视频、PDF；可自行加入其他附件类型。Markdown 及其变体、Bases、Canvas 会从白名单中移除；隐藏路径和 Library 目录同样不能作为附件索引。
4. 运行 **Open, create or upgrade attachment library**。已有 `Attachments Library.base` 会先备份，再追加/维护插件自己的四个视图；原全局过滤、排序、表格、CMS 和未知配置保留。新 Base 同时包含原生表格。
5. 运行 **Scan and index attachments (preview first)**，检查完整的新建路径清单后确认。取消不会写入索引或改变初始化状态。首次确认的完整扫描成功后，才允许为以后新增的附件自动建索引，并采用现有索引的 `al_*` 派生字段。

尚未完成全量扫描时，可运行 **Create metadata for active attachment**，或点击未索引图片的按钮后确认，仅为单个附件建立索引。它不会启用全库自动补建，也不会修改其他旧索引；这个显式新建索引可持续更新自己的派生状态。

## 元数据与旧索引兼容

- 新索引路径为 `Library/<完整 Vault 附件路径>.md`。例如 `A/图.png` 对应 `Library/A/图.png.md`，`B/图.png` 对应另一份索引。
- Library 中已有 `_filePath` 与 `attachment` 一致的旧索引原地采用。任意其他普通笔记不会仅因带有这两个属性而被接管；已标记 `al_schema: 1` 的索引可以放在 Library 以外。
- 附件重命名时，索引原路径保持稳定；更新关联字段，以及新索引中的受控预览块。旧正文、OCR、公式、来源字段、自定义属性不会被全局字符串替换。
- 用户移动/重命名一个已识别的索引后会重新建立映射，必要时仅给这一个文档增加 `al_schema: 1`，让移出 Library 的关联在重启后仍可识别。显式改变 Library 设置同样保留已接受索引的身份。
- 外部删除附件会保留 Markdown，状态显示为 `missing`；外部删除索引不会删除附件，也不会因本次删除立即重建。移出范围显示 `excluded`，保留正文。
- 关联字段不一致、同一目标有多个索引、大小写折叠路径冲突时，显示 `conflict`，禁止修改和清理，不凭同名文件猜测。
- YAML 由 Obsidian 的 `stringifyYaml` 序列化，支持引号、换行、中文路径与中文标签。`status` 继续表示 `unread / reading / done / archived / discarded` 阅读状态。

新增派生字段：

| 字段 | 含义 |
| --- | --- |
| `al_schema: 1` | 本插件索引格式标记 |
| `al_usageCount` | 引用原附件或配套索引的业务来源文件数，集合去重 |
| `al_usageState` | `unknown / used / orphan / missing / conflict / excluded` |
| `al_keep` | 人工保留；设为 `true` 时两种删除操作都拒绝执行 |

新文档包含 `<!-- alp:preview:start -->` / `<!-- alp:preview:end -->` 控制的附件预览，以及 `## OCR`、`## 说明` 两个正文区。可在它们后面自由编辑正文。首次完整扫描前，旧文档的派生状态只在界面计算，不落盘；以后也只写实际变化的属性。

## 图片按钮

在阅读模式和 Live Preview 的本地图片嵌入右上角提供一个链接按钮。解析时使用当前来源文档上下文，支持短链接、别名和尺寸；原图片选择、缩放行为保留在图片本身。

| 操作 | 默认行为 |
| --- | --- |
| 左键 | 当前页打开索引 |
| Cmd/Ctrl + 左键 | 使用系统分发打开元数据的 `source` URL |
| 中键 | 新标签打开索引 |
| 右键 | 选择打开索引、索引新标签、来源 URL |
| 悬停 | 发出指向索引的标准 `hover-link` 事件 |

缺少或不安全的 `source` 会提示，不会误开其他目标；支持 HTTP、HTTPS 与应用 URL scheme，拒绝 `javascript:`、`data:` 等执行或内嵌内容 URI。设置中可以把 Cmd/Ctrl 点击切回原生内部链接行为。尚无索引时点击会明确提出单项创建，悬停始终不创建。

插件注册标准 Page preview 悬停来源（默认要求修饰键）。Hover Editor 可沿用其对标准内部悬停链接的处理；插件不修改 Hover Editor、原生图片工具栏、Bases CMS 源码或它们自己的 Delete 操作。卸载会移除自身按钮、观察器和编辑器扩展。

## 附件库视图

插件注册的 Bases 视图类型为 `attachments-library-peng`，包括 All attachments、Orphan candidates、Cleanable、Needs attention 四个受管理视图。它们使用 Bases 提供的查询结果、排序和分组，并在结果内按当前引用状态筛选。旧的 `al_usageState` 快照不会让实时 `unknown` 项混入可清理项。

默认每页 60 项。换页或 Bases 数据/过滤变化会清空选择；复选框支持单项和当前页全选。图片缩略图懒加载；PDF、音频、视频默认显示图标，点击单项预览才创建对应媒体控件。标题打开索引。卡片提供引用详情、人工保留与手动刷新。

只有标准 `file-menu` 被追加安全的单项操作；插件不读取任何其他插件的私有选择状态。

## 引用口径与保护状态

候选范围即使是单文件夹，来源扫描也覆盖整个 Vault：

- Markdown 正文链接、嵌入、前言链接按来源上下文交给 `metadataCache.getFirstLinkpathDest` 解析。
- 只排除配套索引自身的自动 `attachment` 属性和受控预览块。旧索引中唯一、可明确识别的独立原图预览可排除；歧义会保守标为 `unknown`。索引正文中真正的其他引用仍计入。
- 引用索引文档同样保护原附件；一个来源同时引用原附件和索引只计一次。
- Canvas 的 `file` 节点和文本节点内显式 Markdown 链接纳入；包含空格的尖括号路径、嵌套/转义括号、引用式链接定义均有回归测试。
- Base 的普通查询/卡片展示不算引用。显式 wiki/Markdown 链接和常量 `link()` / `image()` 纳入；动态公式无法判断本地目标时保持 `unknown`。
- 空 Base 没有引用；损坏的 Base/Canvas、读失败、缓存待就绪/过期、无法可靠解析的本地 Markdown 或 HTML 资源引用会保守阻止清理。

引用扫描按来源保存正向/反向集合，变动采用 300ms 去抖增量刷新，并串行执行；卡片不会各自全 Vault 扫描。删除前重新扫描。新正文、前言属性链接会补充解析；来源发生变化而缓存仍旧时不能判定为孤儿。

`unknown` 是保护状态。例如 Vault 内有无法界定目标的动态 Base 公式，可能令全库暂时不能清理；不会为了方便删除而把它当零引用。保守原文解析也可能把代码示例中的显式链接计作引用，产生额外保留项。人工先查看引用详情、修复来源或缓存后刷新。

## 两种人工删除操作

- **Delete metadata only**：只移动索引到回收站，保留原附件；索引有入链时拒绝。
- **Delete attachment + metadata**：同时移动附件和索引；原附件或索引有引用、保留标记、冲突、未知状态、超范围或非唯一关联时拒绝。

受保护项默认跳过，预览显示保留原因；全被保护时只显示阻止原因。预览列出准确文件路径，并提醒元数据正文包含 OCR 或说明。确认之后再次检查完整引用、关联代次、目标 mtime、大小、SHA-256，以及未保存的 Markdown 编辑器；任何变化都会中止或停止后续项，不保存笔记。

成对删除串行执行：先附件，再索引，使用 `app.vault.trash(file, false)` 移到 Vault 本地 `.trash`。附件失败不动索引；索引失败时保留其文档和 `missing` 关联，报告 `partial`。每一对开始前再次检查，中途新增引用会保护尚未执行的项。事务 token 防重复执行；没有永久删除、父目录删除、自动重试或自动续删。

事务原路径、模式、步骤、结果、时间和 `.trash` 恢复目录保存在 `<configDir>/plugins/attachments-library-peng/deletion-log.json`。初始日志无法保存时不开始删除；进度日志失败会停止后续步骤。损坏旧日志先留副本。恢复时查阅日志和 Vault 的 `.trash`，由用户恢复原附件及索引到记录路径；插件不会自动恢复或续删。

## 构建与验证

```sh
npm ci
npm run pipeline
node --test tests/file-policy.acceptance.mjs
```

`pipeline` 包括 ESLint、Vitest 的全源码覆盖检查与 TypeScript/esbuild。四项覆盖率阈值均保持 90%，没有排除新模块。`@codemirror/state` / `@codemirror/view` 开发依赖固定为 `6.5.0` / `6.38.6`，打包继续 external；happy-dom 只用于 DOM 测试。

本次旧测试中“启动自动改 Base”“外删附件连删索引”“附件改名搬迁索引”“中文标签被剥除”等过时预期，已替换成对应的新安全场景；原 PDF 提取、i18n 与仍适用的字段测试保留。新增测试覆盖关联冲突、缓存与引用类型、确认取消、二次引用检查、部分失败、分页选择、按钮路由与卸载清理。

自动测试与 DOM/CodeMirror 模拟测试不能代替实际 Vault 的验收。安装、原生 Bases、阅读模式、Live Preview、Hover Editor、系统外链分发和 `.trash` 恢复需要分别做真实运行验证；本 README 不把源码检查作为这些运行项的通过证明。本地实现未执行发布、推送或 GitHub Release。

实际本地安装与验收结果见 [2026-10-24 验收记录](docs/implementation-acceptance-2026-10-24.md)。
