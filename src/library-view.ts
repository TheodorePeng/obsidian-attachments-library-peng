import { App, BasesView, BasesEntry, Menu, Modal, QueryController, setIcon } from 'obsidian';
import { AttachmentRegistry, AttachmentRecord } from './registry';
import { ReferenceService } from './references';
import { SidecarManager } from './sidecar-manager';
import { DeletionService, DeleteMode } from './deletions';
import { classifyMedia } from './file-policy';
import { confirmAction } from './dialogs';
import { confirmDeletion, showReferenceDetails } from './delete-preview';
import { VIEW_TYPE } from './bases-creator';
export interface LibraryServices {
    registry: AttachmentRegistry;
    references: ReferenceService;
    sidecarManager: SidecarManager;
    deletions: DeletionService;
    refreshUsage: () => Promise<void>;
}
export class PageSelection {
    page = 0;
    selected = new Set<string>();
    constructor(public size = 60) { }
    reset(): void { this.page = 0; this.selected.clear(); }
    move(page: number, total: number): void { this.page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(total / this.size) - 1))); this.selected.clear(); }
    slice<T>(rows: T[]): T[] { return rows.slice(this.page * this.size, (this.page + 1) * this.size); }
    toggle(path: string, checked: boolean): void { if (checked)
        this.selected.add(path);
    else
        this.selected.delete(path); }
}
function button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const el = parent.createEl('button', { text: label });
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
}
export function previewAttachment(app: App, record: AttachmentRecord): void {
    if (!record.asset)
        return;
    const file = record.asset;
    class Preview extends Modal {
        onOpen(): void {
            this.titleEl.setText(file.name);
            const kind = classifyMedia(file.path);
            const url = this.app.vault.getResourcePath(file);
            if (kind === 'image')
                this.contentEl.createEl('img', { attr: { src: url, alt: file.name }, cls: 'alp-full-preview' });
            else if (kind === 'audio' || kind === 'video') {
                const media = this.contentEl.createEl(kind, { cls: 'alp-full-preview' });
                media.src = url;
                media.controls = true;
            }
            else if (kind === 'pdf')
                this.contentEl.createEl('iframe', { attr: { src: url, title: file.name }, cls: 'alp-pdf-preview' });
            else
                button(this.contentEl, 'Open attachment', () => { void this.app.workspace.getLeaf('tab').openFile(file); });
        }
        onClose(): void { for (const media of this.contentEl.querySelectorAll('audio,video')) {
            (media as HTMLMediaElement).pause();
            media.removeAttribute('src');
        } this.contentEl.empty(); }
    }
    new Preview(app).open();
}
export async function requestDeletion(app: App, services: LibraryServices, paths: string[], mode: DeleteMode): Promise<void> {
    try {
        const plan = await services.deletions.prepare(paths, mode);
        if (!await confirmDeletion(app, plan)) return;
        const result = await services.deletions.execute(plan);
        await confirmAction(app, 'Deletion ' + result.status, [result.message, ...result.steps.map(s => s.status + ': ' + s.path + ' — ' + s.recovery)], 'Close');
    }
    catch (error) {
        await confirmAction(app, 'Deletion blocked', [error instanceof Error ? error.message : 'Cannot prepare deletion'], 'Close');
    }
}
export class AttachmentsLibraryView extends BasesView {
    type = VIEW_TYPE;
    readonly selection = new PageSelection();
    constructor(controller: QueryController, private container: HTMLElement, private services: LibraryServices) { super(controller); this.container.addClass('alp-library'); }
    onDataUpdated(): void { const size = this.config.get('pageSize'); this.selection.size = typeof size === 'number' ? Math.max(1, Math.min(200, Math.floor(size))) : 60; this.selection.reset(); this.render(); }
    private record(entry: BasesEntry): AttachmentRecord | undefined { return this.services.registry.byIndex.get(entry.file.path); }
    render(): void {
        this.container.empty();
        const rows = this.data.groupedData.flatMap(group => group.entries.map(entry => ({ entry, key: group.hasKey() ? group.key?.toString() : '', record: this.record(entry) }))).filter(row => {
            if (!row.record)
                return false;
            const mode = this.config.get('alpMode');
            const state = this.services.references.getUsage(row.record).state;
            return mode === 'orphan' ? state === 'orphan' : mode === 'cleanable' ? state === 'orphan' && row.record.metadata.al_keep !== true : mode === 'problems' ? ['unknown', 'missing', 'conflict', 'excluded'].includes(state) : true;
        });
        const queryCount = this.data.groupedData.reduce((n, group) => n + group.entries.length, 0);
        const indexedCount = this.data.groupedData.reduce((n, group) => n + group.entries.filter(entry => this.record(entry)).length, 0);
        this.container.createEl('h3', { text: '附件管理：支持选择与安全删除' });
        this.container.createDiv({ text: '仅显示当前 Base 查询命中的索引；已建立索引不代表全 Vault 已完成补建。', cls: 'alp-manager-intro' });
        const visible = this.selection.slice(rows);
        const toolbar = this.container.createDiv({ cls: 'alp-toolbar' });
        button(toolbar, 'Refresh references', () => { void this.services.refreshUsage().then(() => this.render()); });
        const selected = this.selection.selected;
        const selectAll = toolbar.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Select visible attachments' } });
        selectAll.checked = visible.length > 0 && visible.every(r => selected.has(r.entry.file.path));
        selectAll.addEventListener('change', () => { for (const row of visible)
            this.selection.toggle(row.entry.file.path, selectAll.checked); this.render(); });
        toolbar.createSpan({ text: `${selected.size} selected · ${rows.length} attachments · 查询 ${queryCount} 条 / 附件索引 ${indexedCount} 条 / 全库已识别 ${this.services.registry.byIndex.size} 条` });
        const metadata = button(toolbar, 'Delete metadata only', () => { void requestDeletion(this.app, this.services, [...selected], 'metadata-only').then(() => { this.selection.reset(); this.render(); }); });
        metadata.disabled = !selected.size;
        const pair = button(toolbar, 'Delete attachment + metadata', () => { void requestDeletion(this.app, this.services, [...selected], 'pair').then(() => { this.selection.reset(); this.render(); }); });
        pair.disabled = !selected.size;
        let lastKey: string | undefined;
        for (const row of visible) {
            if (row.key !== lastKey && row.key) {
                this.container.createEl('h3', { text: row.key });
            }
            lastKey = row.key;
            const record = row.record!;
            const usage = this.services.references.getUsage(record);
            const card = this.container.createDiv({ cls: 'alp-card' });
            const check = card.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Select ' + record.assetPath } });
            check.checked = selected.has(row.entry.file.path);
            check.addEventListener('change', () => { this.selection.toggle(row.entry.file.path, check.checked); this.render(); });
            const thumb = button(card, '', () => previewAttachment(this.app, record));
            thumb.addClass('alp-thumbnail');
            thumb.setAttribute('aria-label', 'Preview ' + record.assetPath);
            if (record.asset && classifyMedia(record.assetPath) === 'image')
                thumb.createEl('img', { attr: { src: this.app.vault.getResourcePath(record.asset), alt: record.asset.name, loading: 'lazy' } });
            else
                setIcon(thumb, classifyMedia(record.assetPath) === 'audio' ? 'audio-lines' : classifyMedia(record.assetPath) === 'video' ? 'video' : classifyMedia(record.assetPath) === 'pdf' ? 'file-text' : 'file');
            const details = card.createDiv({ cls: 'alp-details' });
            const title = typeof record.metadata.title === 'string' && record.metadata.title ? record.metadata.title : row.entry.file.basename;
            const link = details.createEl('a', { text: title, attr: { href: record.indexPath ?? '', 'aria-label': 'Open metadata ' + record.assetPath } });
            link.addEventListener('click', event => { event.preventDefault(); if (record.index)
                void this.app.workspace.getLeaf(event.metaKey || event.ctrlKey ? 'tab' : false).openFile(record.index); });
            details.createDiv({ text: record.assetPath, cls: 'alp-path' });
            button(details, `${usage.state} · ${usage.count} sources${!usage.assetCheckComplete || !usage.indexCheckComplete ? ' · 待检查' : ''}`, () => showReferenceDetails(this.app, { assetPath: record.assetPath, indexPaths: record.indexPaths ?? [record.indexPath!], usage, hasUserBody: false, blockedReason: record.reason }));
            const keep = details.createEl('label', { cls: 'alp-keep' });
            const keepInput = keep.createEl('input', { attr: { type: 'checkbox' } });
            keepInput.checked = record.metadata.al_keep === true;
            keep.createSpan({ text: 'Keep' });
            keepInput.addEventListener('change', () => { void this.services.sidecarManager.setKeep(record, keepInput.checked).then(() => this.render()); });
            card.addEventListener('contextmenu', event => { event.preventDefault(); new Menu().addItem(item => item.setTitle('Delete metadata only…').onClick(() => { void requestDeletion(this.app, this.services, [row.entry.file.path], 'metadata-only'); })).addItem(item => item.setTitle('Delete attachment and metadata…').onClick(() => { void requestDeletion(this.app, this.services, [row.entry.file.path], 'pair'); })).showAtMouseEvent(event); });
        }
        const pager = this.container.createDiv({ cls: 'alp-pager' });
        const prev = button(pager, 'Previous', () => { this.selection.move(this.selection.page - 1, rows.length); this.render(); });
        prev.disabled = this.selection.page === 0;
        pager.createSpan({ text: `Page ${this.selection.page + 1} / ${Math.max(1, Math.ceil(rows.length / this.selection.size))}` });
        const next = button(pager, 'Next', () => { this.selection.move(this.selection.page + 1, rows.length); this.render(); });
        next.disabled = (this.selection.page + 1) * this.selection.size >= rows.length;
    }
    onunload(): void { this.container.empty(); this.container.removeClass('alp-library'); this.selection.reset(); }
}
