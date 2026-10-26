import { Plugin, TAbstractFile, TFile, Notice, MarkdownRenderChild } from 'obsidian';
import { AttachmentsLibrarySettings } from './types';
import { SidecarManager } from './sidecar-manager';
import { BasesCreator, VIEW_TYPE } from './bases-creator';
import { AttachmentsLibrarySettingsTab } from './settings';
import { initI18n } from './i18n/i18n';
import { AttachmentRegistry } from './registry';
import { ReferenceService } from './references';
import { DeletionService } from './deletions';
import { AttachmentsLibraryView, requestDeletion } from './library-view';
import { HOVER_SOURCE, ImageNavigation } from './image-navigation';
import { confirmAction } from './dialogs';
import { isEligiblePath } from './file-policy';
import { GalleryPropertyEdits } from './property-edits';
import { GALLERY_HOVER_SOURCE } from './gallery-hover';
import { galleryViewOptions } from './gallery-options';
import { OperationStore } from './operation-store';
import { ManagedPropertyTypes } from './property-types';
import { AttachmentUpdates } from './attachment-updates';
import { PropertyMigration } from './property-migration';
import { chooseItem, enterPath } from './choices';
import { galleryViews, openDestination, settingsFromSaved } from './gallery-destination';
export default class AttachmentsLibraryPlugin extends Plugin {
    settings: AttachmentsLibrarySettings;
    registry: AttachmentRegistry;
    references: ReferenceService;
    deletions: DeletionService;
    sidecarManager: SidecarManager;
    basesCreator: BasesCreator;
    images: ImageNavigation;
    propertyEdits: GalleryPropertyEdits;
    updates: AttachmentUpdates;
    migration: PropertyMigration;
    propertyTypes: ManagedPropertyTypes;
    store = new OperationStore();
    recentReport = 'No operations in this session.';
    readonly galleryViews = new Set<AttachmentsLibraryView>();
    ready: Promise<void> = Promise.resolve();
    private eventQueue = Promise.resolve();
    private stopped = false;
    private initializing = true;
    async onload(): Promise<void> {
        this.register(() => { this.stopped = true; });
        this.store.context = this.app.vault.getName?.() ?? '';
        await this.loadSettings(); await initI18n(); if (this.stopped) return;
        this.registry = new AttachmentRegistry(this.app, this.settings);
        this.references = new ReferenceService(this.app, this.registry);
        this.sidecarManager = new SidecarManager(this.app, this.settings, this.registry);
        this.sidecarManager.references = this.references;
        this.sidecarManager.isActive = () => !this.stopped;
        this.propertyTypes = new ManagedPropertyTypes(this.app, this.registry, this.store);
        this.sidecarManager.ensureTypes = () => this.checkPropertyTypes(true);
        this.references.onRefreshed = async () => {
            if (this.stopped || this.initializing) return;
            for (const record of this.registry.records.values()) if (!this.deletions?.ownsPath(record.assetPath) && !this.deletions?.ownsPath(record.indexPath ?? '')) await this.sidecarManager.writeDerived(record, this.references.getUsage(record));
        };
        this.deletions = new DeletionService(this.app, this.registry, this.references);
        this.propertyEdits = new GalleryPropertyEdits(this.app, this.registry);
        this.propertyEdits.isActive = () => !this.stopped;
        this.propertyEdits.isDeleting = path => this.deletions.ownsPath(path);
        this.propertyEdits.afterSave = async path => { this.registry.invalidate(path); this.references.schedule(path); await this.refreshUsage(); };
        const blocked = (path: string) => this.deletions.ownsPath(path) || this.propertyEdits.hasPending(path);
        this.deletions.hasPendingEdits = path => this.propertyEdits.hasPending(path);
        this.updates = new AttachmentUpdates(this.app, this.registry, this.sidecarManager, this.references, this.store);
        this.migration = new PropertyMigration(this.app, this.registry, this.store);
        this.updates.blocked = this.migration.blocked = blocked;
        this.updates.isActive = this.migration.isActive = () => !this.stopped;
        this.basesCreator = new BasesCreator(this.app, this.settings);
        this.basesCreator.isActive = this.deletions.isActive = () => !this.stopped;
        this.images = new ImageNavigation(this.app, this.settings, this.registry, this.sidecarManager);
        this.registerHoverLinkSource(HOVER_SOURCE, { display: 'Attachments Library Peng', defaultMod: true });
        this.registerHoverLinkSource(GALLERY_HOVER_SOURCE, { display: 'Attachment gallery index', defaultMod: true });
        this.registerBasesView(VIEW_TYPE, { name: '附件画廊（Peng）', icon: 'layout-grid', options: galleryViewOptions, factory: (controller, container) => new AttachmentsLibraryView(controller, container, this) });
        this.registerMarkdownPostProcessor((element, context) => { const child = new MarkdownRenderChild(element); child.register(this.images.observe(element, () => context.sourcePath, child)); context.addChild(child); });
        this.registerEditorExtension(this.images.editorExtension());
        this.register(() => { for (const view of [...this.galleryViews]) view.unload(); this.references.dispose(); this.images.dispose(); if (this.propertyEdits.drafts.size) new Notice('Unsubmitted property drafts were not written.'); this.propertyEdits.dispose(); });
        this.registerVaultEvents();
        this.registerEvent(this.app.metadataCache.on('changed', (file: TFile, data: string) => { this.registry.invalidate(file.path); this.references.cacheChanged(file.path, data); }));
        this.registerEvent(this.app.metadataCache.on('resolved', () => { this.queue(() => this.refreshUsage()); }));
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (!(file instanceof TFile)) return;
            const record = this.registry.byIndex.get(file.path) ?? this.registry.records.get(file.path);
            if (!record?.indexPath) return;
            menu.addItem(item => item.setTitle('Open attachment gallery').setIcon('images').onClick(() => { this.queue(() => this.openLibrary()); }));
            menu.addItem(item => item.setTitle('Attachments library: delete metadata only…').setIcon('file-minus').onClick(() => { void this.requestDeletion([file.path], 'metadata-only'); }));
            menu.addItem(item => item.setTitle('Attachments library: delete attachment and metadata…').setIcon('trash-2').onClick(() => { void this.requestDeletion([file.path], 'pair'); }));
        }));
        this.ready = new Promise<void>(resolve => { this.app.workspace.onLayoutReady(() => { if (this.stopped) { resolve(); return; } void this.restoreGalleryViews().then(() => this.refreshUsage(true)).catch(error => this.report(error)).finally(() => { this.initializing = false; resolve(); }); }); });
        this.addCommand({ id: 'open-library', name: 'Open attachment gallery', callback: () => { this.queue(() => this.openLibrary()); } });
        this.addCommand({ id: 'create-sidecar-for-active', name: 'Update current attachment…', callback: () => { this.queue(() => this.updateCurrent()); } });
        this.addCommand({ id: 'backfill-all', name: 'Scan attachments…', callback: () => { this.queue(() => this.runBackfill()); } });
        this.addSettingTab(new AttachmentsLibrarySettingsTab(this.app, this));
    }
    private report(error: unknown): void { new Notice(error instanceof Error ? error.message : 'Attachments Library operation failed'); }
    private queue(action: () => Promise<void>): void { this.eventQueue = this.eventQueue.then(() => this.stopped ? undefined : action()).catch(error => this.report(error)); }
    private registerVaultEvents(): void {
        this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => {
            if (!(file instanceof TFile)) return;
            this.registry.invalidate(file.path); this.references.schedule(file.path); this.references.invalidateResolution();
            this.queue(async () => { if (this.settings.autoCreateOnNew && isEligiblePath(file.path, this.settings)) { await this.ready; await this.sidecarManager.createSidecar(file); } await this.refreshUsage(); });
        }));
        this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => { this.references.schedule(file.path); this.references.invalidateResolution(); this.queue(() => this.refreshUsage()); }));
        this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            this.references.schedule(oldPath); this.references.schedule(file.path); this.registry.invalidate(file.path);
            this.queue(async () => {
                const base = this.settings.defaultBasePath;
                if (base === oldPath || base?.startsWith(oldPath + '/')) { this.settings.defaultBasePath = file.path + base.slice(oldPath.length); await this.saveData(this.settings); }
                if (file instanceof TFile && file.extension !== 'md') await this.sidecarManager.renameSidecar(oldPath, file.path);
                else { const record = this.registry.byIndex.get(oldPath); if (record && record.metadata.al_schema === undefined) { this.settings.legacyIndexPaths = [...new Set([...(this.settings.legacyIndexPaths ?? []).filter(path => path !== oldPath), file.path])]; await this.saveData(this.settings); } }
                // Relative and short links may resolve differently after a move. Invalidate analysis, not file reads.
                this.references.invalidateResolution();
                await this.refreshUsage();
            });
        }));
        this.registerEvent(this.app.vault.on('modify', (file: TAbstractFile) => { if (!(file instanceof TFile)) return; this.registry.invalidate(file.path); this.references.markDirty(file.path); this.queue(() => this.refreshUsage()); }));
    }
    async refreshUsage(full = false): Promise<void> {
        if (this.stopped) return;
        await this.registry.refresh(full);
        if (this.stopped) return;
        this.images.refresh();
        if (full) await this.references.refresh(); else await this.references.flushDirty();
        for (const view of this.galleryViews) if (view.data) view.onDataUpdated();
    }
    /** Native Bases can retain the previous plugin view instance across a targeted reload. */
    private async restoreGalleryViews(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
            try {
                const state = leaf.getViewState();
                const path = state.state?.file as string | undefined;
                const name = state.state?.viewName as string | undefined;
                const file = path && this.app.vault.getFileByPath(path);
                if (!file || !name) continue;
                const views = galleryViews(await this.app.vault.cachedRead(file));
                if (!views.some(view => view.name === name)) continue;
                const current = leaf.getViewState();
                if (this.stopped || current.state?.file !== path || current.state?.viewName !== name) continue;
                // Public workspace API; preserve the tab and selected Base without writing its configuration.
                await leaf.setViewState({ type: 'empty' });
                await leaf.setViewState(state);
            } catch (error) { this.report(error); }
        }
    }
    private async rememberReport(summary: string, recovery = this.store.lastReport): Promise<void> {
        this.recentReport = summary; this.store.lastReport = recovery;
        if (this.stopped) return;
        this.settings.lastOperationReport = { summary, recovery };
        await this.saveData(this.settings);
    }
    async requestDeletion(paths: string[], mode: 'metadata-only' | 'pair'): Promise<void> { await requestDeletion(this.app, this, paths, mode); }
    async openLibrary(): Promise<void> { await openDestination(this.app, this.settings); }
    async selectBase(): Promise<void> {
        const path = await chooseItem(this.app, 'Choose a Base file', this.app.vault.getFiles().filter(f => f.extension === 'base').map(f => f.path));
        if (!path) return;
        const file = this.app.vault.getFileByPath(path); if (!file) return;
        if (this.settings.defaultBasePath !== path) { this.settings.defaultViewName = ''; this.settings.defaultViewOwner = ''; }
        this.settings.defaultBasePath = path;
        await this.saveSettings();
        const views = galleryViews(await this.app.vault.cachedRead(file));
        if (!views.length) { new Notice('This base has no attachment gallery. Preview a view repair in the maintenance settings.'); return; }
        const name = await chooseItem(this.app, 'Choose a gallery view', views.map(v => v.name));
        if (!name) return;
        const view = views.find(v => v.name === name)!;
        this.settings.defaultBasePath = path; this.settings.defaultViewName = name; this.settings.defaultViewOwner = view.owner;
        await this.saveSettings();
    }
    async selectDefaultView(): Promise<void> {
        const file = this.app.vault.getFileByPath(this.settings.defaultBasePath ?? '');
        if (!file) throw new Error('Choose a Default Base file first.');
        const views = galleryViews(await this.app.vault.cachedRead(file));
        if (!views.length) throw new Error('No gallery view. Use Repair gallery views in Maintenance.');
        const name = await chooseItem(this.app, 'Choose a gallery view', views.map(v => v.name));
        if (!name) return;
        this.settings.defaultViewName = name; this.settings.defaultViewOwner = views.find(v => v.name === name)!.owner; await this.saveSettings();
    }
    async createGallery(): Promise<void> {
        const path = await enterPath(this.app, 'Create attachment Base', 'Attachments Library.base'); if (path === null) return;
        if (!/^(?!\/)(?!.*(?:^|\/)\.\.?\/)[^\\]+\.base$/.test(path) || this.app.vault.getAbstractFileByPath(path)) throw new Error('Choose a new Vault-relative .base path.');
        if (!await confirmAction(this.app, 'Create attachment Base', [path, 'Create a new Base with a table and four attachment gallery views. Existing files are never replaced.'])) return;
        await this.basesCreator.createOrUpdateBaseFile(path);
        this.settings.defaultBasePath = path; this.settings.defaultViewOwner = VIEW_TYPE + ':all';
        const file = this.app.vault.getFileByPath(path)!;
        this.settings.defaultViewName = galleryViews(await this.app.vault.cachedRead(file)).find(v => v.owner === this.settings.defaultViewOwner)!.name;
        await this.saveSettings(); await this.rememberReport('Created attachment base: ' + path, '');
    }
    async reviewLibraryConfiguration(): Promise<void> {
        const path = this.settings.defaultBasePath;
        const file = this.app.vault.getFileByPath(path ?? ''); if (!file) throw new Error('Choose an existing Default Base file first.');
        const original = await this.app.vault.cachedRead(file);
        const { upgradeBase, initializeGalleryViews } = await import('./bases-creator');
        const updated = initializeGalleryViews(upgradeBase(original, this.settings.libraryFolder));
        if (updated === original) { new Notice('Gallery views need no repair.'); return; }
        if (!await confirmAction(this.app, 'Repair gallery views', [file.path, 'Back up and add or repair plugin-owned views only. Preserve existing names, filters, order and other views.', updated])) return;
        const backup = await this.store.save('repair-gallery-views', [{ path: file.path, content: original }], { updated });
        await this.app.vault.process(file, current => { if (this.stopped || current !== original) throw new Error('Base changed; preview again.'); return updated; });
        await this.rememberReport('Gallery views repaired. Backup: ' + backup, backup);
    }
    private async runUpdate(paths: string[]): Promise<void> {
        const items = await this.updates.preview(paths);
        const writes = items.filter(i => i.kind === 'create' || i.kind === 'repair');
        const lines = items.map(i => i.kind + ': ' + i.assetPath + (i.indexPath ? ' → ' + i.indexPath : '') + (Object.keys(i.changes).length ? ' ' + JSON.stringify(i.changes) : '') + (i.reason ? ' — ' + i.reason : ''));
        if (writes.length && !await confirmAction(this.app, 'Update attachment indexes', lines, 'Apply updates')) return;
        if (!writes.length && items.some(i => i.kind === 'conflict' || i.kind === 'excluded')) { await confirmAction(this.app, 'Attachment check results', lines, 'Close'); return; }
        const result = await this.updates.apply(items);
        await this.rememberReport(result.join('\n')); new Notice(this.recentReport || 'No attachments in this scope.'); this.images.refresh();
    }
    async updateCurrent(): Promise<void> { await this.ready; const path = await this.updates.current(); if (!path) { new Notice('No local attachment found in the current file.'); return; } await this.runUpdate([path]); }
    async runBackfill(): Promise<void> {
        await this.ready;
        const scope = await chooseItem(this.app, 'Scan attachments', ['Configured scope', 'Choose a folder']); if (!scope) return;
        let folder = '';
        if (scope === 'Choose a folder') { const folders = [...new Set(this.app.vault.getFiles().filter(f => isEligiblePath(f.path, this.settings)).flatMap(f => f.path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))]; const chosen = await chooseItem(this.app, 'Choose a folder within the configured scope', folders); if (!chosen) return; folder = chosen; }
        await this.runUpdate(this.app.vault.getFiles().filter(f => isEligiblePath(f.path, this.settings) && (!folder || f.path.startsWith(folder + '/'))).map(f => f.path));
    }
    async migrateProperties(): Promise<void> {
        await this.ready; await this.registry.refresh();
        const scope = await chooseItem(this.app, 'Migrate index properties', ['Current index', 'Choose a folder', 'All identified indexes']); if (!scope) return;
        let paths = [...this.registry.byIndex.keys()];
        if (scope === 'Current index') { const active = this.app.workspace.getActiveFile(); const record = active && (this.registry.byIndex.get(active.path) ?? this.registry.records.get(active.path)); paths = record?.indexPaths ?? []; }
        if (scope === 'Choose a folder') { const folder = await chooseItem(this.app, 'Choose an index folder', [...new Set(paths.map(p => p.split('/').slice(0, -1).join('/')))]); if (folder === null) return; paths = paths.filter(p => p.startsWith(folder + '/')); }
        const clean = await chooseItem(this.app, 'Empty legacy template fields', ['Remove known empty template fields', 'Keep empty legacy fields']); if (!clean) return;
        const items = await this.migration.preview(paths, clean.startsWith('Remove'));
        if (!items.length) { new Notice('No identified index in this scope.'); return; }
        if (!await confirmAction(this.app, 'Migrate index properties', items.flatMap(i => [i.path, ...(i.error ? ['Protected: ' + i.error] : i.changes), ...i.dependencies.map(p => 'Base dependency: ' + p)]), 'Back up and migrate')) return;
        await this.checkPropertyTypes(true);
        await this.rememberReport((await this.migration.apply(items)).join('\n'));
        items.forEach(i => this.references.schedule(i.path)); await this.refreshUsage(); new Notice(this.recentReport);
    }
    async checkPropertyTypes(register = false): Promise<void> {
        await this.registry.refresh();
        const result = register ? await this.propertyTypes.register() : this.propertyTypes.check();
        this.recentReport = !result.available ? 'Native type registration is unavailable. Set managed types in Obsidian Properties manually.' : JSON.stringify(result, null, 2);
        if (register) await this.rememberReport(this.recentReport);
        if (!register || !result.available || result.conflicts.length) new Notice(this.recentReport);
    }
    async rebuildReferences(): Promise<void> { await this.ready; await this.refreshUsage(true); await this.rememberReport('Reference index rebuilt. All Vault reference sources checked.', ''); new Notice(this.recentReport); }
    async loadSettings(): Promise<void> { this.settings = await settingsFromSaved(this.app, await this.loadData() as Partial<AttachmentsLibrarySettings> | null); this.recentReport = this.settings.lastOperationReport?.summary ?? this.recentReport; this.store.lastReport = this.settings.lastOperationReport?.recovery ?? ''; }
    async saveSettings(): Promise<void> { if (this.stopped) return; this.settings.legacyIndexPaths = [...new Set([...(this.settings.legacyIndexPaths ?? []), ...[...this.registry.byIndex.values()].filter(record => record.indexPath && !record.indexPath.startsWith(this.settings.libraryFolder + '/') && record.metadata.al_schema === undefined).map(record => record.indexPath!)])]; await this.saveData(this.settings); await this.refreshUsage(); }
}
