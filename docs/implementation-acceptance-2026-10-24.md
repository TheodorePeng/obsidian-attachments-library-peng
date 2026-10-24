# Attachments Library Peng 本地实施与验收记录

日期：2026-10-24（Asia/Shanghai）。源码已实现、构建，并安装启用在 Math Peng。以下分别记录自动检查、真实运行证据和未完成的验收；不将它们混为全部通过。

## 源码与活跃构建

- 项目：`/Users/peng/Documents/GitHub-Peng/ObsidianPlugins-Peng/obsidian-attachments-library-peng`。
- 独立 ID：`attachments-library-peng`；显示名 Attachments Library Peng；版本 1.1.0；最低声明 1.13.1。
- 原 HEAD `0258800148ed97b898697a961741838d04521bb7` 保持；全部修改未提交。没有 commit、push、发布或其他插件升级。
- 初期现场为 Obsidian 1.14.4；过程中观察到应用已重启为 **1.14.5（installer 1.13.7）**。最终修复后的真实 UI 验证在 1.14.5 完成；没有由本任务发起整应用重载，未声称最终构建已重新通过 1.14.4 全矩阵。
- 外部 Worker 仅实现隔离的纯文件策略助手，Codex 审阅并修正后应用。核心关联、字段协议、引用、安全删除与部署由 Codex 负责，并经独立审查。

安装目录为 `<Math Peng>/.obsidian/plugins/attachments-library-peng/`，仅复制三个产物，既有 data.json 不覆盖。首次安装前该独立目录无产物；所有替换均核对上一次写入哈希后进行。CLI 刷新清单后启用，最后再次定向重载两次，活跃实例版本、关联数量与按钮唯一性稳定。

| 产物 | 最终 SHA-256 |
| --- | --- |
| main.js | `7e7fd6ce29a0643de57a7ac8503788466ced8f0fc8bc826065384d22c2a7d3d4` |
| manifest.json | `b09d16cf54706d0b8a488416681d4c01e3e5d5af7423b3c0b77323ce905426fe` |
| styles.css | `07978375a72c009afaa376046e0e108971c7800a52d311080df4a405bfeac48d` |

## 自动检查

| 检查 | 最终结果 |
| --- | --- |
| npm ci | 成功，使用锁文件 |
| npm run pipeline | 成功：lint、覆盖率、TypeScript/esbuild |
| Vitest | **155/155**，15 个测试文件 |
| 语句 / 分支 / 函数 / 行覆盖 | **97.26% / 91.32% / 96.25% / 97.68%** |
| 独立 Node 文件策略验收 | **14/14** |
| git diff --check | 通过 |
| bash -n install.sh | 通过；PowerShell 安装器未在 Windows 执行 |

四项覆盖率门槛保持 90%，新增模块均纳入。独立安全审查复查相关 49 项通过。原 PDF 与 i18n 测试保留；旧测试中的自动删索引、改名搬迁索引、剥除中文等旧预期改成新安全契约。

ESLint 无错误，有一条已知建议：优先 FileManager.trashFile。实现按批准方案使用 Vault.trash(file,false)，固定本地 .trash，故保留该警告。npm 审计报告 13 项漏洞（6 moderate、7 high），与基线相同；未执行可能改变依赖行为的 audit fix，未宣称依赖无漏洞。

## 真实运行验证

临时命名空间：`ALP_QA_20261024_005324`，配套索引在 `Library/ALP_QA_20261024_005324`。使用有效 PNG、WAV、MP4 与单页 PDF；测试不调用 OCR 服务。

| 项目 | 观察结果 |
| --- | --- |
| 初启只读与旧关联 | 初始 28 份有效索引识别；29 份既有 Library Markdown 哈希全部不变；无全库补建 |
| 四种媒体单项索引 | 原地创建完整路径镜像索引；Markdown 未产生索引 |
| 引用去重 | 同一普通笔记同时引用附件及索引只计 1；Canvas file 节点与索引单独入链被计入 |
| 管理预览排除 | 新索引的属性及受控预览不计业务引用，计数为 0 |
| 附件外删 | PDF 索引与 OCR/正文保留，实时状态 missing、计数 0 |
| 附件改名 | WAV 改成中文名，索引原路径稳定，手工加入中文 OCR 正文保留 |
| 索引外删 | MP4 原文件保留，未立即重建索引 |
| Base 配置 | 临时 Base 两次升级结果完全相同；原 table、CMS、自定义属性和全局筛选保留；只加 4 个 owned 视图 |
| 主 Base | 先备份，再追加 4 视图；原表格真实渲染 135 个单元格；CMS 容器真实渲染；专用视图显示 31 条已关联记录 |
| 实时清理筛选 | Cleanable 为 0，Needs attention 为 31；未知项未混入待清理 |
| 渲染负载 | 专用卡片默认没有 audio/video/iframe 实例；图片使用 lazy 属性 |
| 阅读按钮 | 两次嵌入各 1 个按钮；真实 CDP 左键当前索引、中键新索引标签；位置距图片上/右各 8px |
| 实时预览按钮 | 当前笔记上下文正确；真实点击打开索引；笔记源码前后完全一致 |
| Command 悬浮 | 标准 hover-link 指向索引；真实 Page Preview/Hover Editor 弹出同一索引，含 1 个 cm-editor；截图留档 |
| HTTP 出处 | 真实 Command 点击，实际浏览器标签到达 https://example.com/?alp_qa=20261024，标题 Example Domain |
| 应用 scheme | 同一点击路由准确分发到合成 marginnote4app 测试目标；测试拦截最终系统调用，没有冒充真实页面定位 |
| 停用与重载 | 停用后按钮 0；启用与二次重载后，每处嵌入最多 1 个按钮，索引总数稳定 31，Base 仍仅 4 个 owned 视图 |
| 恢复 | 测试 PDF 从 Vault `.trash/sample.pdf` 恢复至原路径，SHA-256 与有效原 fixture 完全一致，原索引复用 |
| 错误捕获 | 最终验收期间调试控制台无新错误；历史其他插件报错不归为本插件通过/失败证据 |

Command 悬浮使用真实 Electron DOM 与 CDP 输入；Math 窗口位于后台时启用了临时焦点模拟，结束后已还原。临时事件监听、window.open 包装与调试连接均已移除。

运行时发现并修复了两项模拟测试未覆盖的问题：缺失附件被原生解析回退到同名 Markdown 索引；未挂载渲染容器中按钮添加/清理造成观察器循环。已增加回归、重跑完整 pipeline，并用真实 Vault 重新验证缺失状态、阅读/实时预览与连续重载。图片按钮布局经截图修正为右上角。

## 保护状态与未完成项

Math Peng 的三个 TSNotes Base 包含动态 link(note["URL-TSNotes"],…) 公式，另有数学原文形如 `[1-F(x)][1-F(y)]` 被保守分析视作未确定的引用式语法。因此未缺失的候选保持 unknown。本次没有更改这些来源，没有把未知当作零引用。

**真实 Vault 的成功成对删除/仅删索引事务未完成验收**，因为产品安全门禁应阻止这些候选。成功、取消、两阶段失败、中途新增引用、文件变化、并发 token、日志失败等由自动测试验证。真实 .trash 移入与恢复针对明确 QA 临时文件通过 Obsidian API 验证；不能把它当作产品成对删除流程已全程通过。

以下仍需人工或后续受控环境验证：真实 MarginNote URL 对应页面定位；最终构建在 1.14.4 的完整重验；动态目标范围可明确的隔离 Vault 中，产品删除确认到恢复的完整成功事务；大量媒体、跨平台播放编解码与 Windows 安装器。默认分页、筛选选择清空、分组排序和部分失败路径有自动/DOM 测试，现场 31 条记录未制造超过 60 条的真实分页压力测试。

当前 initialScanComplete=false。首次全库建立索引仍须用户在产品的扫描预览中明确确认；未偷偷执行。用户可直接打开主 Base 的 All attachments 管理视图，编辑索引正文及来源；unknown 记录应先查看原因。

## Vault 改动与恢复

部署前备份目录（0700）：`/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/alp-deploy-20261024-4dt_pwec`。包含业务文件基线哈希、插件替换版本、最终产物清单和精确文件差异。更早的 29 份 Library 与 Base 副本仍位于 `/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/alp-backup-20261023-zvnvv0jo`。

既有业务文件唯一变更：`Attachments Library.base`。原文副本保存在 Vault 的 `Attachments Library.base.alp-backup`，另有上述任务备份。旧 29 份 Library 文档均逐份哈希核对未变，其中非索引文档未被接管。启用插件只增改相应社区插件启用记录；没有覆盖任何既有插件设置。

保留的新增业务文件共 11 个，供用户查看：

- `ALP_QA_20261024_005324/Library.base`
- `ALP_QA_20261024_005324/Library.base.alp-backup`
- `ALP_QA_20261024_005324/assets/sample.mp4`
- `ALP_QA_20261024_005324/assets/sample.pdf`
- `ALP_QA_20261024_005324/assets/图.png`
- `ALP_QA_20261024_005324/assets/音频.wav`
- `ALP_QA_20261024_005324/image-navigation.md`
- `Attachments Library.base.alp-backup`
- `Library/ALP_QA_20261024_005324/assets/sample.pdf.md`
- `Library/ALP_QA_20261024_005324/assets/sample.wav.md`
- `Library/ALP_QA_20261024_005324/assets/图.png.md`

测试中移到 .trash 的普通引用笔记、Canvas 和 MP4 索引保留可恢复；PDF 已恢复。产品事务日志路径为 `<configDir>/plugins/attachments-library-peng/deletion-log.json`，本轮因门禁阻止真实产品事务，未宣称有实际成功事务日志。

回滚前必须核对目标仍为本次写入版本；不得覆盖用户测试后的修改。插件回滚可定向停用并恢复相应备份产物；主 Base 只在当前哈希仍符合最终清单时恢复原副本。不要回写工作区或其他全局设置，不自动清理保留的 QA 材料。

原始工具证据集中于 `/tmp/alp-original-pipeline.log`、`/tmp/alp-original-policy.log`、`/tmp/alp-runtime-qa-ALP_QA_20261024_005324`、`/tmp/alp-runtime-extended-ALP_QA_20261024_005324`、`/tmp/alp-final-ui`、`/tmp/alp-scheme-runtime.json`、`/tmp/alp-runtime-recovery.json`、`/tmp/alp-pointer-qa/hover.png`。早期失败日志保留作为修复证据，最终状态以上述重新验证结果为准。

最终界面截图与关键原始证据另复制至上述备份目录的 `evidence/`；测试标签页已在确认其内容已保存后关闭，主 Base 的 All attachments 视图留作查看。隔离实现工作树 `/tmp/alp-implementation-20261023` 保留作历史交接材料；最终源码以用户原项目目录为准，后续运行修复已在原项目中完成。
