import { App, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { AttachmentsLibrarySettings } from './types';
import { GALLERY_DEFAULT_ORDER } from './gallery-config';
export const VIEW_TYPE = 'attachments-library-peng';
const OWNER = VIEW_TYPE + ':';
export function upgradeBase(content: string, libraryFolder: string): string {
    const parsed: unknown = content.trim() ? parseYaml(content) : { filters: { and: ['file.ext == "md"', { or: ['al_schema == 1', 'al_schema == 2', { and: [`file.inFolder(${JSON.stringify(libraryFolder)})`, '_filePath != null', 'attachment != null'] }] }] }, views: [{ type: 'table', name: 'Metadata table', order: ['file.name', 'url', 'keep'] }] };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Base must be a YAML mapping');
    const config = parsed as Record<string, unknown>;
    if (config.views !== undefined && !Array.isArray(config.views))
        throw new Error('Base views must be a list');
    const views = (config.views ?? []) as Record<string, unknown>[];
    if (views.some(v => !v || typeof v !== 'object' || Array.isArray(v)))
        throw new Error('Invalid Base view');
    const definitions: [
        string,
        string
    ][] = [['all', '附件管理'], ['orphan', '孤儿候选'], ['cleanable', '待清理'], ['problems', '异常与待检查']];
    let changed = !content.trim();
    for (const [id, name] of definitions) {
        const marker = OWNER + id;
        const existing = views.find(v => v.alpOwned === marker);
        if (existing) {
            const expected = { ...existing, type: VIEW_TYPE, alpOwned: marker, alpMode: id };
            if (JSON.stringify(existing) !== JSON.stringify(expected)) {
                Object.keys(existing).forEach(k => delete existing[k]);
                Object.assign(existing, expected);
                changed = true;
            }
        }
        else {
            const view: Record<string, unknown> = { type: VIEW_TYPE, name, alpOwned: marker, alpMode: id, pageSize: 60, order: [...GALLERY_DEFAULT_ORDER], image: 'note.attachment' };
            views.push(view);
            changed = true;
        }
    }
    config.views = views;
    return changed ? stringifyYaml(config) : content;
}
export function reviewBaseConfiguration(content: string, libraryFolder: string, referencedNames: Set<string>): { content: string; changes: string[] } {
    const config = parseYaml(content) as Record<string, unknown>;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Base must be a YAML mapping');
    const changes: string[] = [];
    const names: Record<string, string> = { all: '附件管理', orphan: '孤儿候选', cleanable: '待清理', problems: '异常与待检查' };
    for (const view of (config.views ?? []) as Record<string, unknown>[]) {
        if (typeof view.alpOwned !== 'string' || typeof view.name !== 'string') continue;
        const mode = view.alpOwned.replace('attachments-library-peng:', '');
        if (!names[mode] || view.name === names[mode]) continue;
        if (referencedNames.has(view.name)) { changes.push('保留被引用的旧视图名：' + view.name); continue; }
        changes.push('视图名：' + view.name + ' → ' + names[mode]); view.name = names[mode];
    }
    const managed = (parseYaml(upgradeBase('', libraryFolder)) as Record<string, unknown>).filters;
    const marker = 'al_schema == 1';
    if (!JSON.stringify(config.filters ?? null).includes(marker)) {
        changes.push('扩展全局筛选：保留原条件并加入已识别索引范围。');
        config.filters = config.filters ? { or: [config.filters, managed] } : managed;
    }
    const output = stringifyYaml(config);
    return { content: JSON.stringify(parseYaml(content)) === JSON.stringify(config) ? content : output, changes };
}
/** Initialize only missing property order on this plugin's own views. */
export function initializeGalleryViews(content: string): string {
    const parsed: unknown = parseYaml(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Base must be a YAML mapping');
    const config = parsed as Record<string, unknown>;
    if (config.views !== undefined && !Array.isArray(config.views)) throw new Error('Base views must be a list');
    let changed = false;
    for (const view of (config.views ?? []) as Record<string, unknown>[]) {
        if (view && view.type === VIEW_TYPE && typeof view.alpOwned === 'string' && view.alpOwned.startsWith(OWNER) && view.order === undefined) { view.order = [...GALLERY_DEFAULT_ORDER]; changed = true; }
    }
    return changed ? stringifyYaml(config) : content;
}
export class BasesCreator {
    isActive: () => boolean = () => true;
    constructor(private app: App, private settings: AttachmentsLibrarySettings) { }
    getBaseFilePathForFolder(folder: string): string { const f = folder.trim(); return normalizePath(f ? `${f}/Attachments Library.base` : 'Attachments Library.base'); }
    getBaseFilePath(): string { return this.getBaseFilePathForFolder(this.settings.baseFolderPath); }
    async createOrUpdateBaseFile(pathOverride?: string, upgrade = false): Promise<string> {
        const path = pathOverride ?? this.getBaseFilePath();
        if (!this.isActive())
            return path;
        if (!path.endsWith('.base'))
            throw new Error('Choose a .base file');
        const existing = this.app.vault.getFileByPath(path);
        if (existing && !upgrade) return path;
        const original = existing ? await this.app.vault.cachedRead(existing) : '';
        const updated = upgradeBase(original, this.settings.libraryFolder);
        if (!this.isActive() || updated === original)
            return path;
        const folder = path.split('/').slice(0, -1).join('/');
        if (folder && !this.app.vault.getAbstractFileByPath(folder))
            await this.app.vault.createFolder(folder);
        if (!this.isActive())
            return path;
        if (existing) {
            let backup = path + '.alp-backup';
            let suffix = 1;
            while (this.app.vault.getFileByPath(backup))
                backup = path + '.alp-backup-' + suffix++;
            await this.app.vault.create(backup, original);
            if (this.isActive())
                await this.app.vault.modify(existing, updated);
        }
        else
            await this.app.vault.create(path, updated);
        return path;
    }
    async ensureGalleryDefaults(path: string): Promise<void> {
        const file = this.app.vault.getFileByPath(path); if (!file || !this.isActive()) return;
        const original = await this.app.vault.cachedRead(file);
        const updated = initializeGalleryViews(original); if (updated === original || !this.isActive()) return;
        let backup = path + '.alp-gallery-backup'; let suffix = 1;
        while (this.app.vault.getAbstractFileByPath(backup)) backup = path + '.alp-gallery-backup-' + suffix++;
        await this.app.vault.create(backup, original);
        await this.app.vault.process(file, current => { if (!this.isActive() || current !== original) throw new Error('Base 已变化，请重新打开；原配置已备份'); return updated; });
    }
    async moveBaseFile(oldFolder: string, newFolder: string): Promise<void> {
        if (!this.isActive())
            return;
        const oldPath = this.getBaseFilePathForFolder(oldFolder), newPath = this.getBaseFilePathForFolder(newFolder);
        if (oldPath === newPath)
            return;
        const file = this.app.vault.getFileByPath(oldPath);
        if (!file)
            return;
        if (this.app.vault.getFileByPath(newPath))
            throw new Error('Destination Base already exists');
        if (newFolder.trim() && !this.app.vault.getAbstractFileByPath(newFolder.trim()))
            await this.app.vault.createFolder(newFolder.trim());
        if (this.isActive())
            await this.app.fileManager.renameFile(file, newPath);
    }
}
