# 发布流水线验收（1.6.2，2026-11-14）

1.6.2 是**纯发布工具链版本**：插件运行时与 1.6.1 完全一致，随 1.6.2 GitHub Release 发布，通过 BRAT 从 `TheodorePeng/obsidian-attachments-library-peng` 安装或更新。

本轮**未做隔离运行验收**，也**未部署到任何 Vault**——因为本轮没有任何运行时变化需要验收。1.6.1 的验收记录与运行边界见 [acceptance-1.6.1-2026-11-14.md](acceptance-1.6.1-2026-11-14.md)。

## 变更范围

1.6.1 → 1.6.2 的 `src/` 与 `tests/` **没有任何改动**，改的只有发布工具链：

- **`release.sh` / `release.ps1` 重写为五个阶段**：validate（只读校验）→ notes（只写临时文件）→ verify（只动 gitignored 产物）→ bump / commit / tag / push → publish。所有校验排在任何 tracked 文件改动之前，构建失败不会留下脏工作区。
- **脚本自己创建 GitHub Release**：改用 `gh release create --verify-tag --title <version> --notes-file ... --latest main.js manifest.json styles.css`。原先的 tag 触发工作流在本仓库从未产生过任何一次运行，旧脚本打完标签不会有可下载的 Release。
- **已有 Release 会被修复而不是重复创建**：检测到同版本 Release 已存在时，用本地构建替换三个 BRAT 资源并重新应用发布说明。
- **`--dry-run` 不再夸大结果**：只打印命令，不写入 / 提交 / 推送 / 打标签 / 发布，并明确报告没有发布任何内容。
- **Windows 脚本对齐**：`release.ps1` 同样的五个阶段；`manifest.json` 用 `node` 改写，不带 BOM、不打乱 JSON 键顺序；`Invoke-Step` 把命令输出排空，不再混入 `Publish-Release` 的返回值。

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 problems |
| `CI=true npm run test` | 通过，39 个测试文件、369 项测试 |
| `npm run test:coverage` | 通过，阈值门禁（90%）满足 |
| `npm run build` | 通过，`tsc -noEmit -skipLibCheck` 与 esbuild 生产构建均无错误 |
| `node --experimental-strip-types --test tests/*.acceptance.mjs` | 通过，4 个脚本共 57 项测试 |
| `git diff --check` | 通过 |

覆盖率与 1.6.1 完全一致：

| 覆盖率 | 结果 |
| --- | --- |
| Statements | 95.46% |
| Branches | 90.03% |
| Functions | 94.11% |
| Lines | 98.99% |

## 构建产物一致性

重新构建后的 `main.js` 为 728182 字节，sha256 `75ec3443881294e564fd7f1797a702a0ae1f6d51691ad075e4083cc2e00cda91`，**与 1.6.1 发布的 asset 逐字节相同**；`styles.css` 11563 字节，sha256 `e20af92ac791e54bde79cf0396a859a9ab13418e558dbe4e31f42c4db83e7f34`，同样与 1.6.1 一致。这两点同时证明：本轮没有引入任何运行时变化，且构建是可复现的。

`main.js` 不入库，仅作为 Release asset 上传；发布后用 `brat_release_guard.py verify --version 1.6.2` 复核，要求 `status: verified` 且三个 asset 与本地文件的 SHA-256 逐字节相同。

## 发布脚本回归证据

- **错误输入先失败。** `bash release.sh 1.6.2 --notes-file /tmp/does-not-exist.md` 退出码 1，报 `Error: notes file not found`；此时版本仍为 1.6.1、本地与远端均无 1.6.2 tag、工作区 0 处改动、GitHub 上无 1.6.2 Release。
- **dry-run 无副作用。** `bash release.sh 1.6.2 --dry-run` 打印全部命令后报告未发布任何内容；版本、tag、工作区、HEAD 全部不变。

## 数据变化与验证边界

- 本轮**未部署到任何 Vault**，未触碰主 Vault 或测试 Vault，未创建、修改或删除任何用户数据。
- 本轮**未做隔离运行验收**：没有运行时变化，因此没有需要真实运行验证的新行为。1.6.1 遗留的运行验收边界（英文文案渲染、附件目录候选交互、**Turn off Keep…** 完整点击路径、移动端表现）依然有效，未因 1.6.2 得到改善或恶化。
- 兼容性：`minAppVersion` 保持 `1.13.1`；1.6.2 与 1.6.1 的插件运行时完全相同，升级不需要迁移任何设置或数据；`data.json` 由 Obsidian 与 BRAT 保留。
