import { Plugin, TAbstractFile, TFile, Notice, MarkdownRenderChild, parseYaml } from 'obsidian';
import { AttachmentsLibrarySettings, DEFAULT_SETTINGS } from './types';
import { SidecarManager } from './sidecar-manager';
import { BackfillManager } from './backfill';
import { BasesCreator, VIEW_TYPE, reviewBaseConfiguration } from './bases-creator';
import { AttachmentsLibrarySettingsTab } from './settings';
import { initI18n } from './i18n/i18n';
import { AttachmentRegistry } from './registry';
import { ReferenceService } from './references';
import { DeletionService } from './deletions';
import { AttachmentsLibraryView, requestDeletion } from './library-view';
import { HOVER_SOURCE, ImageNavigation } from './image-navigation';
import { confirmAction } from './dialogs';
import { parseMarkdownLinks } from './markdown-links';
import { isEligiblePath, normalizeExtensions } from './file-policy';
export default class AttachmentsLibraryPlugin extends Plugin {
    settings: AttachmentsLibrarySettings;
    registry: AttachmentRegistry;
    references: ReferenceService;
    deletions: DeletionService;
    sidecarManager: SidecarManager;
    basesCreator: BasesCreator;
    images: ImageNavigation;
    ready: Promise<void> = Promise.resolve();
    private backfillManager: BackfillManager;
    private eventQueue = Promise.resolve();
    private stopped = false;
    async onload(): Promise<void> {
        this.register(() => { this.stopped = true; });
        await this.loadSettings();
        await initI18n();
        if (this.stopped)
            return;
        this.registry = new AttachmentRegistry(this.app, this.settings);
        this.references = new ReferenceService(this.app, this.registry);
        this.sidecarManager = new SidecarManager(this.app, this.settings, this.registry);
        this.sidecarManager.references = this.references;
        this.sidecarManager.isActive = () => !this.stopped;
        this.references.onRefreshed = async () => { if (this.stopped)
            return; const snapshots = [...this.registry.records.values()].map(record => ({ record, usage: this.references.getUsage(record) })); for (const { record, usage } of snapshots)
            if (!this.deletions?.ownsPath(record.assetPath) && !this.deletions?.ownsPath(record.indexPath ?? '')) await this.sidecarManager.writeDerived(record, usage); };
        this.deletions = new DeletionService(this.app, this.registry, this.references);
        this.backfillManager = new BackfillManager(this.app, this.settings, this.sidecarManager, () => this.saveData(this.settings));
        this.basesCreator = new BasesCreator(this.app, this.settings);
        this.basesCreator.isActive = () => !this.stopped;
        this.deletions.isActive = () => !this.stopped;
        this.images = new ImageNavigation(this.app, this.settings, this.registry, this.sidecarManager);
        this.registerHoverLinkSource(HOVER_SOURCE, { display: 'Attachments Library Peng', defaultMod: true });
        this.registerBasesView(VIEW_TYPE, { name: 'Attachments Library Peng', icon: 'images', factory: (controller, container) => new AttachmentsLibraryView(controller, container, this) });
        this.registerMarkdownPostProcessor((element, context) => { const child = new MarkdownRenderChild(element); child.register(this.images.observe(element, () => context.sourcePath, child)); context.addChild(child); });
        this.registerEditorExtension(this.images.editorExtension());
        this.register(() => { this.references.dispose(); this.images.dispose(); });
        this.registerVaultEvents();
        this.registerEvent(this.app.metadataCache.on('changed', (file: TFile, data: string) => { this.references.cacheChanged(file.path, data); }));
        this.registerEvent(this.app.metadataCache.on('resolved', () => { this.queue(() => this.refreshUsage()); }));
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (!(file instanceof TFile))
                return;
            const record = this.registry.byIndex.get(file.path) ?? this.registry.records.get(file.path);
            if (!record?.indexPath)
                return;
            menu.addItem(item => item.setTitle('在附件管理中查看').setIcon('images').onClick(() => { this.queue(() => this.openLibrary()); }));
            menu.addItem(item => item.setTitle('Attachments library: delete metadata only…').setIcon('file-minus').onClick(() => { void requestDeletion(this.app, this, [file.path], 'metadata-only'); }));
            menu.addItem(item => item.setTitle('Attachments library: delete attachment and metadata…').setIcon('trash-2').onClick(() => { void requestDeletion(this.app, this, [file.path], 'pair'); }));
        }));
        this.ready = new Promise<void>(resolve => { this.app.workspace.onLayoutReady(() => { if (this.stopped) {
            resolve();
            return;
        } void this.refreshUsage().catch(error => this.report(error)).finally(resolve); }); });
        this.addCommand({ id: 'backfill-all', name: 'Scan and index attachments (preview first)', callback: () => { this.queue(() => this.runBackfill()); } });
        this.addCommand({ id: 'create-sidecar-for-active', name: 'Create metadata for active attachment', checkCallback: (checking: boolean) => { const file = this.app.workspace.getActiveFile(); if (!file || !isEligiblePath(file.path, this.settings))
                return false; if (!checking)
                this.queue(async () => { await this.sidecarManager.createSidecar(file); this.images.refresh(); }); return true; } });
        this.addCommand({ id: 'open-library', name: 'Open, create or upgrade attachment library', callback: () => { this.queue(() => this.openLibrary()); } });
        this.addCommand({ id: 'refresh-references', name: 'Refresh attachment references (read only before first scan)', callback: () => { this.queue(() => this.refreshUsage()); } });
        this.addCommand({ id: 'review-library-configuration', name: '整理附件管理视图与范围（预览）', callback: () => { this.queue(() => this.reviewLibraryConfiguration()); } });
        this.addSettingTab(new AttachmentsLibrarySettingsTab(this.app, this));
    }
    private report(error: unknown): void { new Notice(error instanceof Error ? error.message : 'Attachments Library operation failed'); }
    private queue(action: () => Promise<void>): void { this.eventQueue = this.eventQueue.then(() => this.stopped ? undefined : action()).catch(error => this.report(error)); }
    private registerVaultEvents(): void {
        this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => { if (!(file instanceof TFile))
            return; this.queue(async () => { if (this.settings.initialScanComplete && this.settings.autoCreateOnNew && isEligiblePath(file.path, this.settings))
            await this.sidecarManager.createSidecar(file); await this.refreshUsage(); }); }));
        this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => { if (!(file instanceof TFile))
            return; this.references.schedule(file.path); this.queue(() => this.refreshUsage()); }));
        this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => { if (!(file instanceof TFile))
            return; this.queue(async () => { if (file.extension !== 'md')
            await this.sidecarManager.renameSidecar(oldPath, file.path);
        else {
            const record = this.registry.byIndex.get(oldPath);
            if (record)
                await this.sidecarManager.patch(record, { al_schema: 1 });
        } await this.refreshUsage(); }); }));
        this.registerEvent(this.app.vault.on('modify', (file: TAbstractFile) => { if (!(file instanceof TFile))
            return; this.references.markDirty(file.path); if (this.registry.byIndex.has(file.path) || isEligiblePath(file.path, this.settings))
            this.queue(async () => { if (isEligiblePath(file.path, this.settings))
                await this.sidecarManager.updateSidecarDates(file); if (this.registry.byIndex.has(file.path))
                await this.registry.refresh(); }); }));
    }
    async refreshUsage(): Promise<void> {
        if (this.stopped)
            return;
        await this.registry.refresh();
        if (this.stopped)
            return;
        this.images.refresh();
        await this.references.refresh();
    }
    async openLibrary(pathOverride?: string): Promise<void> {
        const path = await this.basesCreator.createOrUpdateBaseFile(pathOverride);
        const file = this.app.vault.getFileByPath(path);
        if (!file) return;
        let config = parseYaml(await this.app.vault.cachedRead(file)) as { views?: { name: string; alpOwned?: string }[] };
        let view = config.views?.find(v => v.alpOwned === 'attachments-library-peng:all');
        if (!view) {
            if (!await confirmAction(this.app, '为现有 Base 添加附件管理？', [path, '备份原文件，只追加四个管理视图；保留筛选、现有视图及名称。'], '备份并添加')) return;
            await this.basesCreator.createOrUpdateBaseFile(path, true);
            config = parseYaml(await this.app.vault.cachedRead(file)) as typeof config;
            view = config.views?.find(v => v.alpOwned === 'attachments-library-peng:all');
        }
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        if (view && !this.stopped) await leaf.setViewState({ type: 'bases', state: { file: path, viewName: view.name } });
    }
    async reviewLibraryConfiguration(): Promise<void> {
        const path = this.basesCreator.getBaseFilePath(); const file = this.app.vault.getFileByPath(path);
        if (!file) { await this.openLibrary(); return; }
        const original = await this.app.vault.cachedRead(file);
        const existing = parseYaml(original) as { views?: { name: string }[] };
        const referenced = new Set<string>();
        for (const source of this.app.vault.getMarkdownFiles()) {
            try {
                const links = parseMarkdownLinks(await this.app.vault.cachedRead(source)).links;
                for (const item of links) {
                    const [target, ...fragment] = item.link.split('#');
                    if (fragment.length && this.app.metadataCache.getFirstLinkpathDest(target, source.path)?.path === path) referenced.add(decodeURIComponent(fragment.join('#')));
                }
            } catch { existing.views?.forEach(view => referenced.add(view.name)); }
        }
        const proposal = reviewBaseConfiguration(original, this.settings.libraryFolder, referenced);
        if (proposal.content === original) { new Notice('现有配置无需调整，或旧名称正在被引用。'); return; }
        if (!await confirmAction(this.app, '整理附件管理配置', [path, ...proposal.changes, '原全局筛选：' + JSON.stringify((parseYaml(original) as Record<string, unknown>).filters), '新全局筛选：' + JSON.stringify((parseYaml(proposal.content) as Record<string, unknown>).filters)], '备份并应用')) return;
        if (this.stopped || await this.app.vault.cachedRead(file) !== original) { new Notice('Base 已变化，请重新预览。'); return; }
        let backup = path + '.alp-backup'; let suffix = 1;
        while (this.app.vault.getFileByPath(backup)) backup = path + '.alp-backup-' + suffix++;
        await this.app.vault.create(backup, original);
        if (!this.stopped) await this.app.vault.modify(file, proposal.content);
        await this.openLibrary();
    }
    async runBackfill(): Promise<void> { await this.backfillManager.runBackfill(); }
    getBaseFilePathFor(folder: string): string { return this.basesCreator.getBaseFilePathForFolder(folder); }
    async moveBaseFile(oldFolder: string, newFolder: string): Promise<void> { await this.basesCreator.moveBaseFile(oldFolder, newFolder); }
    async migrateTagsProperty(oldName: string, newName: string): Promise<number> { await this.registry.refresh(); return this.sidecarManager.migrateTagsProperty(oldName, newName); }
    async sanitizeSidecarTags(): Promise<number> { await this.registry.refresh(); return this.sidecarManager.sanitizeSidecarTags(); }
    async loadSettings(): Promise<void> { const saved = await this.loadData() as Partial<AttachmentsLibrarySettings> | null; this.settings = Object.assign({}, DEFAULT_SETTINGS, saved); this.settings.watchedExtensions = normalizeExtensions(this.settings.watchedExtensions); }
    async saveSettings(): Promise<void> { if (this.stopped)
        return; for (const record of this.registry.byIndex.values())
        if (record.indexPath && !record.indexPath.startsWith(this.settings.libraryFolder + '/'))
            await this.sidecarManager.patch(record, { al_schema: 1 }); await this.saveData(this.settings); await this.refreshUsage(); }
}
