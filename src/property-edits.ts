import { App, MarkdownView, TFile } from 'obsidian';
import { AttachmentRegistry, readDocument } from './registry';
import { isGalleryPropertyReadOnly, notePropertyKey } from './gallery-policy';
export type PropertyEditKind = 'text' | 'number' | 'date' | 'datetime' | 'list' | 'boolean';
export interface PropertyDraft {
    id: string; indexPath: string; propertyId: string; key: string; file: TFile;
    initial: unknown; existed: boolean; kind: PropertyEditKind; input: string; error?: string; saving: boolean;
}
const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key) === true;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function propertyEditKind(value: unknown): PropertyEditKind | null {
    if (value == null) return 'text';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null;
    if (Array.isArray(value)) return value.every(item => typeof item === 'string') ? 'list' : null;
    if (typeof value !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
    return 'text';
}
export function propertyInput(value: unknown, kind: PropertyEditKind): string {
    if (value == null) return '';
    if (kind === 'list' && Array.isArray(value)) return value.join('\n');
    if (kind === 'datetime' && typeof value === 'string') return value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '');
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
function validDate(input: string): boolean {
    const date = new Date(input + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input;
}
export function parsePropertyInput(input: string, kind: PropertyEditKind, initial?: unknown): unknown {
    if (propertyEditKind(initial) === kind && input === propertyInput(initial, kind)) return initial == null ? (kind === 'boolean' ? false : kind === 'list' ? [] : null) : initial;
    if (kind === 'boolean') { if (input !== 'true' && input !== 'false') throw new Error('请选择布尔值'); return input === 'true'; }
    if (kind === 'list') return input.split(/\r?\n/).filter(item => item.trim());
    if (!input.trim()) return null;
    if (kind === 'number') { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.trim()) || !Number.isFinite(Number(input))) throw new Error('请输入有效数字'); return Number(input); }
    if (kind === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !validDate(input)) throw new Error('请输入有效日期'); return input; }
    if (kind === 'datetime') {
        if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(input) || !validDate(input.slice(0, 10))) throw new Error('请输入有效日期和时间');
        const zone = typeof initial === 'string' ? initial.match(/(?:Z|[+-]\d{2}:\d{2})$/)?.[0] ?? '' : '';
        return input + zone;
    }
    return input;
}
/** In-memory drafts and atomic, field-level writes. No note body is reconstructed here. */
export class GalleryPropertyEdits {
    readonly drafts = new Map<string, PropertyDraft>();
    private queues = new Map<string, Promise<void>>();
    private listeners = new Set<() => void>();
    isActive = (): boolean => true;
    isDeleting = (_path: string): boolean => false;
    afterSave?: () => Promise<void>;
    constructor(private app: App, private registry: AttachmentRegistry) {}
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    private emit(): void { for (const listener of this.listeners) listener(); }
    hasPending(path: string): boolean { return [...this.drafts.values()].some(draft => draft.indexPath === path); }
    async begin(indexPath: string, propertyId: string): Promise<PropertyDraft> {
        if (!this.isActive()) throw new Error('插件已停用');
        if (isGalleryPropertyReadOnly(propertyId)) throw new Error('此属性只读');
        const key = notePropertyKey(propertyId)!;
        const id = JSON.stringify([indexPath, key]); const existing = this.drafts.get(id); if (existing) return existing;
        await this.registry.refresh();
        const file = this.app.vault.getFileByPath(indexPath);
        if (!file || !this.registry.byIndex.has(indexPath)) throw new Error('索引不存在或已不属于附件库');
        if (this.isDeleting(indexPath)) throw new Error('索引正在回收');
        const metadata = readDocument(await this.app.vault.read(file)).metadata;
        const existed = own(metadata, key), initial = existed ? metadata[key] : undefined;
        const kind = key === 'al_keep' && initial == null ? 'boolean' : propertyEditKind(initial);
        if (!kind) throw new Error('复杂属性请在索引笔记中编辑');
        // Another view may have opened this draft while the disk read was pending.
        if (this.drafts.has(id)) return this.drafts.get(id)!;
        const draft: PropertyDraft = { id, indexPath, propertyId, key, file, initial, existed, kind, input: key === 'al_keep' && initial == null ? 'false' : propertyInput(initial, kind), saving: false };
        this.drafts.set(id, draft); this.emit(); return draft;
    }
    cancel(id: string): void { if (!this.drafts.get(id)?.saving) { this.drafts.delete(id); this.emit(); } }
    async save(id: string): Promise<void> {
        const draft = this.drafts.get(id); if (!draft) throw new Error('编辑已结束');
        if (draft.saving) throw new Error('正在保存');
        let value: unknown;
        try { value = parsePropertyInput(draft.input, draft.kind, draft.initial); } catch (error) { draft.error = error instanceof Error ? error.message : '输入无效'; this.emit(); throw error; }
        if (draft.existed && equal(value, draft.initial)) { this.drafts.delete(id); this.emit(); return; }
        draft.saving = true; draft.error = undefined; this.emit();
        const run = (this.queues.get(draft.indexPath) ?? Promise.resolve()).then(async () => {
            if (!this.isActive() || this.isDeleting(draft.indexPath)) throw new Error('插件停用或索引正在回收');
            const file = this.app.vault.getFileByPath(draft.indexPath);
            if (file !== draft.file || !this.registry.byIndex.has(draft.indexPath)) throw new Error('索引位置或身份已变化');
            for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
                const view = leaf.view;
                if (view instanceof MarkdownView && view.file?.path === draft.indexPath && view.editor.getValue() !== await this.app.vault.read(file)) throw new Error('索引笔记有未保存编辑，请先保存');
            }
            await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
                if (!this.isActive() || this.isDeleting(draft.indexPath)) throw new Error('操作已停止');
                if (own(frontmatter, draft.key) !== draft.existed || !equal(frontmatter[draft.key], draft.initial)) throw new Error('该属性已被其他位置修改；输入已保留，请核对后重新编辑');
                frontmatter[draft.key] = value;
            });
            this.drafts.delete(id);
            await this.registry.refresh();
        });
        this.queues.set(draft.indexPath, run.catch(() => {}));
        try { await run; try { await this.afterSave?.(); } catch { /* The atomic write succeeded; normal metadata events will retry the refresh. */ } }
        catch (error) { draft.error = error instanceof Error ? error.message : '保存失败'; throw error; }
        finally { draft.saving = false; this.emit(); }
    }
    async toggle(indexPath: string, propertyId: string, value: boolean): Promise<void> {
        const id = JSON.stringify([indexPath, notePropertyKey(propertyId)]);
        if (this.drafts.has(id)) throw new Error('该属性有未提交编辑，请先处理草稿');
        const draft = await this.begin(indexPath, propertyId);
        if (draft.kind !== 'boolean') { this.cancel(draft.id); throw new Error('属性类型已变化'); }
        draft.input = String(value); await this.save(draft.id);
    }
    dispose(): void { this.isActive = () => false; this.listeners.clear(); this.drafts.clear(); }
}
