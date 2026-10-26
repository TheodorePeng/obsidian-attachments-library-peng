# Attachments Library Peng 1.4.0 实施约定

## 属性与兼容

新索引只生成 attachment、url、keep、_filePath、_fileType、al_schema、al_usageCount、al_usageState；schema 为 2。前三项为业务属性，后五项为兼容及运行快照。用户自己添加的 source、tags 等属性不归插件管理。新索引保留受控预览块、OCR 和说明章节。

旧索引继续读取 source URL 和 al_keep；规范 URL 一旦存在就优先于旧 source。任一保留字段为 true、类型无效、两者冲突或新版缺少 keep，均保持保护。后台不为缺失的 keep 写 false。关联和派生字段在画廊只读，URL 与保留标记由用户编辑。

显式迁移先预览、备份，再用文件身份、内容摘要、未保存编辑及草稿检查串行写入。旧 URL 转入 url；有意义的旧标题、非默认阅读状态归档到正文末尾 Legacy metadata，原正文原样保留。schema 2 的同名用户属性不参与旧模板清理。发现 Base 依赖时保留相关旧字段，并明确列出需要人工复核的 Base；本轮不对混合新旧用途的查询或公式猜测重写。

原生类型适配器集中检测 getAssignedWidget/setType 能力，只登记八个必需字段。已有类型或值冲突时不覆盖，只列出文件。不可用时提供原生 Properties 修复指引，不直接写 types.json。

## 设置与默认入口

设置页分 Gallery、Indexing、Managed properties、Image button、Maintenance，全部英文。全 Vault 模式隐藏 Attachment folder，但保留其值；Index notes folder 只影响新文档。

Default Base file 为完整 Vault 相对路径，通过文件选择器选择；Default view 选择其中的插件画廊。打开命令只读，复用匹配标签或新开标签，并显式加载 deferred Base；不创建或升级配置；归属标记存在时用于跟踪视图改名，否则使用明确选择的名字。文件重命名同步路径，删除后不重建。任意其他 Base 仍可使用画廊。

选择 Base 文件与选择视图分别保存；尚无画廊的文件也可以先绑定，再通过维护页明确修复。创建 Base、修复视图和迁移都是独立操作。用户原有筛选、视图、名称和属性顺序保留。旧 Base folder 只用于查找已存在的 Attachments Library.base，不创建文件。

## 命令与更新范围

- Open attachment gallery：只打开默认 Base 及指定视图。
- Update current attachment…：识别原附件、索引、编辑器光标链接或当前笔记附件选择；只补建或修复该目标。
- Scan attachments…：选择配置范围或其中的文件夹；预览创建、修复、冲突和排除项。

保留对应旧命令 ID；移除独立刷新及混合配置整理命令，提供手动快捷键重绑提示。不自动修改快捷键。

旧自动索引权限按 autoCreateOnNew && initialScanComplete 迁移；新安装默认关闭。显式启用后只处理未来新增附件，不要求先全库补建。

## 缓存、安全与恢复

旧索引移出默认目录时，在插件设置中记住已识别路径；修改索引目录不会为了兼容而批量写入旧文档。最近操作摘要及恢复位置随设置保存。

启动只读建立全 Vault 关联与引用缓存。常规操作处理脏文件，新建或移动导致的链接重解析复用未变化来源的文本缓存；引用检查仍覆盖全 Vault。初始化和 Maintenance 的 Rebuild reference index 才执行完整重读。缓存不完整时不允许从局部零引用推断可删除。

插件定向重载时使用公开 workspace API 重新连接已打开的插件画廊标签，保留 Base 配置和标签位置，避免旧视图实例留下空白。

保留现有删除预览、保护门禁、未保存编辑检查、回收顺序和本地 .trash。属性隐藏不改变保护。私有备份和报告位于 ~/.local/share/attachments-library-peng/backups，目录 0700，文件 0600；正式验收范围为 macOS，Node 恢复功能延迟加载，不在移动端启动时加载桌面模块。

## 验证与部署

执行 npm ci、lint、完整覆盖率、build、独立 Node 策略检查和 git diff --check，四项覆盖率最低 90%。先在 Obsidian AI Coding 验证单项及范围更新、迁移、类型冲突、保留、删除和恢复，再在 Math Peng 核对既有材料和 Cards/CMS/Hover Editor 共存。

部署只复制 main.js、manifest.json、styles.css，保留 data.json；应用内设置兼容在用户操作保存时持久化。部署和 QA 使用外部 0700 备份及 SHA-256 清单。Math Peng 不进行既有材料真实迁移或全库补建。不自动提交、推送或发布。
