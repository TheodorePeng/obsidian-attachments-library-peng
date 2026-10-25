import { App, BasesView, BasesEntry, Menu, Modal, QueryController, setIcon, Notice, RenderContext, BasesPropertyId, NullValue, ListValue } from 'obsidian';
import { AttachmentRegistry, AttachmentRecord } from './registry';
import { ReferenceService } from './references';
import { SidecarManager } from './sidecar-manager';
import { DeletionService, DeleteMode } from './deletions';
import { classifyMedia } from './file-policy';
import { confirmAction } from './dialogs';
import { confirmDeletion, showReferenceDetails } from './delete-preview';
import { VIEW_TYPE } from './bases-creator';
import { normalizeGalleryOptions, GalleryOptions } from './gallery-config';
import { galleryRowsSignature, isGalleryPropertyReadOnly, isEmptyGalleryValue, notePropertyKey } from './gallery-policy';
import { GalleryPropertyEdits, propertyEditKind } from './property-edits';
import { GalleryPropertyEditor } from './property-editor';
import { GalleryIndexLinks } from './gallery-hover';
export interface LibraryServices {
    app: App;
    registry: AttachmentRegistry;
    references: ReferenceService;
    sidecarManager: SidecarManager;
    deletions: DeletionService;
    refreshUsage: () => Promise<void>;
    propertyEdits?: GalleryPropertyEdits;
    galleryViews?: Set<AttachmentsLibraryView>;
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
interface GalleryRow { entry: BasesEntry; record: AttachmentRecord; group: string; groupLabel: string; }
interface PropertyCell { element: HTMLElement; fingerprint: string; }
interface GalleryCard {
    element: HTMLElement; cover: HTMLButtonElement; properties: HTMLElement; check: HTMLInputElement;
    row: GalleryRow; cells: Map<string, PropertyCell>; coverSource: string;
}
export class AttachmentsLibraryView extends BasesView {
    type = VIEW_TYPE;
    readonly selection = new PageSelection();
    private root: HTMLElement;
    private toolbar: HTMLElement;
    private scroll: HTMLElement;
    private content: HTMLElement;
    private pager: HTMLElement;
    private cards = new Map<string, GalleryCard>();
    private groups = new Map<string, { element: HTMLElement; grid: HTMLElement; label: HTMLElement }>();
    private signature = '';
    private selectionMode = false;
    private links: GalleryIndexLinks;
    private edits: GalleryPropertyEdits;
    private editor: GalleryPropertyEditor;
    private unsubscribe: () => void;
    private options: GalleryOptions & { coverEnabled: boolean };
    private stopped = false;
    constructor(controller: QueryController, private container: HTMLElement, private services: LibraryServices) {
        super(controller);
        this.app = services.app;
        container.addClass('alp-gallery-host');
        this.root = container.createDiv({ cls: 'alp-gallery' });
        this.toolbar = this.root.createDiv({ cls: 'alp-gallery-toolbar' });
        this.scroll = this.root.createDiv({ cls: 'alp-gallery-scroll' });
        this.content = this.scroll.createDiv({ cls: 'alp-gallery-content' });
        this.pager = this.root.createDiv({ cls: 'alp-gallery-pager' });
        this.links = new GalleryIndexLinks(services.app);
        this.edits = services.propertyEdits ?? new GalleryPropertyEdits(services.app, services.registry);
        this.editor = new GalleryPropertyEditor(this.edits, container.ownerDocument);
        this.unsubscribe = this.edits.subscribe(() => { if (!this.stopped) this.renderToolbar(this.rows().length); });
        this.options = { ...normalizeGalleryOptions({}), coverEnabled: true };
        services.galleryViews?.add(this);
    }
    private getOptions(): GalleryOptions & { coverEnabled: boolean } {
        const keys = ['cardSize', 'cardGap', 'contentPadding', 'pageSize', 'image', 'imageFit', 'imageAspectRatio', 'propertyLabels', 'showEmptyProperties'];
        return { ...normalizeGalleryOptions(Object.fromEntries(keys.map(key => [key, this.config.get(key)]))), coverEnabled: this.config.get('coverEnabled') !== false };
    }
    private rows(): GalleryRow[] {
        const mode = this.config.get('alpMode');
        return this.data.groupedData.flatMap((group, groupIndex) => group.entries.flatMap(entry => {
            const record = this.services.registry.byIndex.get(entry.file.path); if (!record) return [];
            const state = this.services.references.getUsage(record).state;
            if (mode === 'orphan' && state !== 'orphan' || mode === 'cleanable' && (state !== 'orphan' || record.metadata.al_keep === true) || mode === 'problems' && !['unknown', 'missing', 'conflict', 'excluded'].includes(state)) return [];
            const label = group.hasKey() ? group.key?.toString() ?? '' : '';
            return [{ entry, record, group: JSON.stringify([groupIndex, label]), groupLabel: label }];
        }));
    }
    onDataUpdated(): void {
        const rows = this.rows();
        const signature = galleryRowsSignature(rows.map(row => ({ key: row.group, paths: [row.entry.file.path] })));
        const next = this.getOptions();
        if (signature !== this.signature || next.pageSize !== this.selection.size) this.selection.reset();
        this.signature = signature;
        this.options = next; this.selection.size = next.pageSize;
        this.render();
    }
    render(): void {
        if (this.stopped) return;
        const rows = this.rows(), visible = this.selection.slice(rows);
        this.root.style.setProperty('--alp-card-size', this.options.cardSize + 'px');
        this.root.style.setProperty('--alp-card-gap', this.options.cardGap + 'px');
        this.root.style.setProperty('--alp-gallery-padding', this.options.contentPadding + 'px');
        this.root.classList.toggle('alp-selection-mode', this.selectionMode);
        this.root.classList.toggle('alp-hide-property-labels', !this.options.propertyLabels);
        this.renderToolbar(rows.length);
        const order = this.config.getOrder();
        const alive = new Set(visible.map(row => row.entry.file.path));
        for (const [path, card] of this.cards) if (!alive.has(path)) { this.disposeCard(card); this.cards.delete(path); }
        const groupOrder = [...new Set(visible.map(row => row.group))];
        for (const [key, group] of this.groups) if (!groupOrder.includes(key)) { group.element.remove(); this.groups.delete(key); }
        let groupCursor = this.content.firstChild;
        for (const key of groupOrder) {
            let group = this.groups.get(key);
            if (!group) {
                const element = this.container.ownerDocument.createElement('section'); element.className = 'alp-gallery-group';
                const label = element.createDiv({ cls: 'alp-gallery-group-label' });
                const grid = element.createDiv({ cls: 'alp-gallery-grid', attr: { role: 'list' } });
                group = { element, grid, label }; this.groups.set(key, group);
            }
            const groupLabel = visible.find(row => row.group === key)!.groupLabel;
            group.label.setText(groupLabel); group.label.hidden = !groupLabel;
            if (group.element !== groupCursor) this.content.insertBefore(group.element, groupCursor);
            groupCursor = group.element.nextSibling;
            let cardCursor = group.grid.firstChild;
            for (const row of visible.filter(row => row.group === key)) {
                let card = this.cards.get(row.entry.file.path);
                if (!card) { card = this.createCard(row); this.cards.set(row.entry.file.path, card); }
                card.row = row;
                this.updateCard(card, order);
                if (card.element !== cardCursor) group.grid.insertBefore(card.element, cardCursor);
                cardCursor = card.element.nextSibling;
            }
        }
        this.content.querySelector('.alp-gallery-empty')?.remove();
        if (!rows.length) this.content.createDiv({ text: '没有符合条件的附件索引', cls: 'alp-gallery-empty' });
        this.renderPager(rows.length);
    }
    private open(row: GalleryRow, newTab = false): void { void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(row.entry.file); }
    private createCard(row: GalleryRow): GalleryCard {
        const element = this.container.ownerDocument.createElement('article'); element.className = 'alp-gallery-card'; element.tabIndex = 0; element.setAttribute('role', 'listitem');
        const check = element.createEl('input', { cls: 'alp-gallery-select', attr: { type: 'checkbox', 'aria-label': '选择索引 ' + row.entry.file.path } });
        const cover = element.createEl('button', { cls: 'alp-gallery-cover', attr: { type: 'button', 'aria-label': '打开索引 ' + row.entry.file.basename } });
        const actions = element.createDiv({ cls: 'alp-gallery-card-actions' });
        const properties = element.createDiv({ cls: 'alp-gallery-properties' });
        const card: GalleryCard = { element, cover, properties, check, row, cells: new Map(), coverSource: '' };
        check.addEventListener('click', event => event.stopPropagation());
        check.addEventListener('change', () => { this.selection.toggle(card.row.entry.file.path, check.checked); this.render(); });
        const preview = this.icon(actions, 'scan-eye', '预览原附件', () => previewAttachment(this.app, card.row.record));
        preview.disabled = !row.record.asset;
        this.icon(actions, 'ellipsis', '卡片操作', event => this.cardMenu(card.row, event));
        element.addEventListener('click', event => {
            if ((event.target as Element).closest('a,input,textarea,select,.alp-property-edit,.alp-gallery-card-actions')) return;
            this.open(card.row, event.metaKey || event.ctrlKey);
        });
        element.addEventListener('auxclick', event => {
            if (event.button !== 1 || (event.target as Element).closest('a,input,textarea,select,.alp-property-edit,.alp-gallery-card-actions')) return;
            event.preventDefault(); this.open(card.row, true);
        });
        element.addEventListener('keydown', event => { if (event.target === element && event.key === 'Enter') { event.preventDefault(); this.open(card.row, event.metaKey || event.ctrlKey); } });
        element.addEventListener('contextmenu', event => { if ((event.target as Element).closest('input,textarea,select,.alp-property-value a')) return; event.preventDefault(); event.stopPropagation(); this.cardMenu(card.row, event); });
        return card;
    }
    private icon(parent: HTMLElement, icon: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
        const control = parent.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label, title: label } }); setIcon(control, icon);
        control.addEventListener('click', event => { event.stopPropagation(); action(event); }); return control;
    }
    private updateCard(card: GalleryCard, order: BasesPropertyId[]): void {
        const { row } = card;
        card.element.dataset.indexPath = row.entry.file.path;
        card.element.setAttribute('aria-label', '索引 ' + row.entry.file.basename);
        card.element.classList.toggle('is-selected', this.selection.selected.has(row.entry.file.path));
        card.check.checked = this.selection.selected.has(row.entry.file.path);
        card.element.dataset.selected = String(card.check.checked);
        card.element.querySelector<HTMLButtonElement>('[aria-label="预览原附件"]')!.disabled = !row.record.asset;
        this.updateCover(card);
        const alive = new Set(order);
        for (const [id, cell] of card.cells) if (!alive.has(id as BasesPropertyId)) { this.disposeCell(cell); card.cells.delete(id); }
        let cursor = card.properties.firstChild;
        for (const id of order) {
            const value = row.entry.getValue(id);
            const key = notePropertyKey(id);
            const fm = this.app.metadataCache.getFileCache(row.entry.file)?.frontmatter;
            const raw: unknown = key && fm && Object.prototype.hasOwnProperty.call(fm, key) ? fm[key] : undefined;
            const boolean = typeof raw === 'boolean' || key === 'al_keep';
            const empty = !boolean && (value == null || value instanceof NullValue || value instanceof ListValue && !value.isTruthy() || isEmptyGalleryValue(value.toString()));
            let cell = card.cells.get(id);
            if (empty && !this.options.showEmptyProperties) { if (cell) { this.disposeCell(cell); card.cells.delete(id); } continue; }
            const nativeLabel = this.config.getDisplayName(id);
            // Older Bases store note property aliases without the note. prefix.
            const label = key && id.startsWith('note.') && nativeLabel === key ? this.config.getDisplayName(key as BasesPropertyId) : nativeLabel;
            const fingerprint = JSON.stringify([value?.toString(), raw, label, boolean]);
            if (!cell) { cell = { element: card.properties.ownerDocument.createElement('div'), fingerprint: '' }; cell.element.className = 'alp-gallery-property'; cell.element.dataset.property = id; cell.element.classList.toggle('alp-gallery-name', id === 'file.name' || key === 'title'); card.cells.set(id, cell); }
            const existingTitle = cell.element.querySelector<HTMLAnchorElement>('.alp-gallery-title');
            if (cell.fingerprint !== fingerprint && existingTitle && (id === 'file.name' || key === 'title')) {
                existingTitle.setText(value?.toString() ?? ''); cell.element.querySelector('.alp-property-label')?.setText(label); cell.fingerprint = fingerprint;
            }
            if (cell.fingerprint !== fingerprint) {
                this.clearCell(cell.element); cell.fingerprint = fingerprint;
                cell.element.createDiv({ text: label, cls: 'alp-property-label' });
                const output = cell.element.createDiv({ cls: 'alp-property-value' });
                if (id === 'file.name' || key === 'title') {
                    const anchor = output.createEl('a', { text: value?.toString() ?? '', cls: 'alp-gallery-title' });
                    this.links.bind(anchor, row.entry.file.path);
                    const open = (event: MouseEvent) => { if (event.button !== 0 && event.button !== 1) return; event.preventDefault(); event.stopPropagation(); this.open(card.row, event.button === 1 || event.metaKey || event.ctrlKey); };
                    anchor.addEventListener('click', open); anchor.addEventListener('auxclick', open);
                } else if (boolean && !isGalleryPropertyReadOnly(id)) {
                    const input = output.createEl('input', { attr: { type: 'checkbox', 'aria-label': label } }); input.checked = raw === true || raw === undefined && value?.toString() === 'true';
                    input.addEventListener('click', event => event.stopPropagation());
                    input.addEventListener('change', () => { input.disabled = true; void this.edits.toggle(card.row.entry.file.path, id, input.checked).catch(error => { input.checked = !input.checked; new Notice(error instanceof Error ? error.message : '保存失败'); }).finally(() => { input.disabled = false; this.render(); }); });
                } else {
                    value?.renderTo(output, Object.assign(new RenderContext(), { app: this.app, sourcePath: row.entry.file.path }));
                    if (empty) output.setText('—');
                    output.addEventListener('click', event => { if ((event.target as Element).closest('a')) event.stopPropagation(); });
                }
                if (!boolean && !isGalleryPropertyReadOnly(id) && propertyEditKind(raw)) {
                    const edit = this.icon(cell.element, 'pencil', '编辑 ' + label, () => { void this.openEditor(card.row.entry.file.path, id, cell.element, label); }); edit.addClass('alp-property-edit');
                    if (!boolean && id !== 'file.name' && key !== 'title') output.addEventListener('click', event => { if ((event.target as Element).closest('a')) return; event.preventDefault(); event.stopPropagation(); void this.openEditor(card.row.entry.file.path, id, cell.element, label); });
                }
            }
            if (cell.element !== cursor) card.properties.insertBefore(cell.element, cursor);
            cursor = cell.element.nextSibling;
        }
        card.properties.hidden = card.properties.childElementCount === 0;
    }
    private updateCover(card: GalleryCard): void {
        const selected = this.options.image;
        const value = selected ? card.row.entry.getValue(selected as BasesPropertyId)?.toString() : '';
        const wiki = value?.match(/^!?\[\[([^\]|#]+)(?:[^\]]*)\]\]$/)?.[1];
        const raw = wiki ?? value ?? '';
        const local = raw && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw) ? this.app.metadataCache.getFirstLinkpathDest(raw, card.row.entry.file.path) : null;
        const image = local && classifyMedia(local.path) === 'image' ? local : undefined;
        const source = image ? this.app.vault.getResourcePath(image) : '';
        card.cover.hidden = !this.options.coverEnabled || selected === null;
        card.cover.style.aspectRatio = this.options.imageAspectRatio.replace(':', ' / ');
        if (card.coverSource !== source || !card.cover.childElementCount) {
            card.coverSource = source; card.cover.empty();
            if (source) card.cover.createEl('img', { attr: { src: source, alt: card.row.record.asset?.name ?? card.row.entry.file.basename, loading: 'lazy', decoding: 'async' } });
            else setIcon(card.cover, classifyMedia(card.row.record.assetPath) === 'audio' ? 'audio-lines' : classifyMedia(card.row.record.assetPath) === 'video' ? 'video' : classifyMedia(card.row.record.assetPath) === 'pdf' ? 'file-text' : 'file-image');
        }
        const img = card.cover.querySelector('img'); if (img) img.style.objectFit = this.options.imageFit;
    }
    private async openEditor(path: string, id: string, anchor?: HTMLElement, label?: string): Promise<void> {
        try { const draft = await this.edits.begin(path, id); if (!this.stopped) this.editor.open(draft, anchor, label); }
        catch (error) { new Notice(error instanceof Error ? error.message : '无法编辑'); }
    }
    private clearCell(element: HTMLElement): void { element.querySelectorAll<HTMLAnchorElement>('.alp-gallery-title').forEach(anchor => this.links.unbind(anchor)); element.empty(); }
    private disposeCell(cell: PropertyCell): void { this.clearCell(cell.element); cell.element.remove(); }
    private disposeCard(card: GalleryCard): void { for (const cell of card.cells.values()) this.disposeCell(cell); card.element.remove(); }
    private cardMenu(row: GalleryRow, event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle('打开索引').onClick(() => this.open(row)));
        menu.addItem(item => item.setTitle('新标签打开索引').onClick(() => this.open(row, true)));
        menu.addItem(item => item.setTitle('预览原附件').onClick(() => previewAttachment(this.app, row.record)));
        menu.addItem(item => item.setTitle('打开原附件').onClick(() => { if (row.record.asset) void this.app.workspace.getLeaf('tab').openFile(row.record.asset); }));
        menu.addItem(item => item.setTitle('关联与引用详情（实时）').onClick(() => showReferenceDetails(this.app, { assetPath: row.record.assetPath, indexPaths: row.record.indexPaths ?? [row.entry.file.path], usage: this.services.references.getUsage(row.record), hasUserBody: false, blockedReason: row.record.reason })));
        this.deleteItems(menu, [row.entry.file.path]); menu.showAtMouseEvent(event);
    }
    private deleteItems(menu: Menu, paths: string[]): void {
        for (const [mode, label] of [['metadata-only', '仅删除索引…'], ['pair', '删除附件及索引…']] as const) menu.addItem(item => item.setTitle(label).onClick(() => { void requestDeletion(this.app, this.services, paths, mode).then(() => { this.selection.selected.clear(); this.render(); }); }));
    }
    private renderToolbar(total: number): void {
        this.toolbar.empty();
        const select = button(this.toolbar, this.selectionMode ? '退出选择' : '选择', () => { this.selectionMode = !this.selectionMode; if (!this.selectionMode) this.selection.selected.clear(); this.render(); });
        select.setAttribute('aria-pressed', String(this.selectionMode));
        if (this.selectionMode || this.selection.selected.size) {
            const all = this.toolbar.createEl('input', { attr: { type: 'checkbox', 'aria-label': '选择当前页' } });
            const visible = this.selection.slice(this.rows()); all.checked = visible.length > 0 && visible.every(row => this.selection.selected.has(row.entry.file.path));
            all.addEventListener('change', () => { for (const row of visible) this.selection.toggle(row.entry.file.path, all.checked); this.render(); });
            this.toolbar.createSpan({ text: '已选 ' + this.selection.selected.size, cls: 'alp-selection-count' });
            button(this.toolbar, '清空', () => { this.selection.selected.clear(); this.render(); });
            if (this.selection.selected.size) button(this.toolbar, '安全删除', () => { const menu = new Menu(); this.deleteItems(menu, [...this.selection.selected]); const rect = this.toolbar.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }); });
        }
        const spacer = this.toolbar.createDiv({ cls: 'alp-gallery-toolbar-spacer' }); spacer.setAttribute('aria-hidden', 'true');
        this.icon(this.toolbar, 'refresh-cw', '刷新引用', () => { void this.services.refreshUsage().then(() => this.render()); });
        this.icon(this.toolbar, 'ellipsis', this.edits.drafts.size ? '更多 · 有未提交编辑' : '更多', event => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle('库信息').onClick(() => { void confirmAction(this.app, '附件库信息', ['本 Base 查询 ' + this.data.groupedData.reduce((count, group) => count + group.entries.length, 0) + ' 条', '当前模式附件索引 ' + total + ' 条', '全库已识别索引 ' + this.services.registry.byIndex.size + ' 条', '只管理已关联的索引；普通文档不会成为附件卡片。'], '关闭'); }));
            for (const draft of this.edits.drafts.values()) menu.addItem(item => item.setTitle('继续编辑：' + draft.indexPath + ' · ' + draft.key).onClick(() => this.editor.open(draft)));
            menu.showAtMouseEvent(event);
        });
    }
    private renderPager(total: number): void {
        this.pager.empty(); this.pager.hidden = total <= this.selection.size;
        if (this.pager.hidden) return;
        const previous = button(this.pager, '上一页', () => { this.selection.move(this.selection.page - 1, total); this.render(); this.scroll.scrollTop = 0; }); previous.disabled = this.selection.page === 0;
        this.pager.createSpan({ text: `${this.selection.page + 1} / ${Math.ceil(total / this.selection.size)}` });
        const next = button(this.pager, '下一页', () => { this.selection.move(this.selection.page + 1, total); this.render(); this.scroll.scrollTop = 0; }); next.disabled = (this.selection.page + 1) * this.selection.size >= total;
    }
    onunload(): void { this.stopped = true; this.services.galleryViews?.delete(this); this.unsubscribe(); this.editor.close(); this.links.dispose(); this.cards.clear(); this.groups.clear(); this.selection.reset(); this.container.empty(); this.container.removeClass('alp-gallery-host'); }
}
