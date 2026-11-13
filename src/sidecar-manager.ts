import { allocateIndexPath, occupiedPaths, validateFolder } from './paths';
import { newMetadata, managedIssues } from './managed-properties';
import { App, MarkdownView, TFile, stringifyYaml } from 'obsidian';
import { AttachmentsLibrarySettings } from './types';

type CreationResult = 'created' | 'existing' | 'skipped';

import { AttachmentRegistry, AttachmentRecord, PREVIEW_END, PREVIEW_START, readDocument } from './registry';
import { isEligiblePath } from './file-policy';
import type { ReferenceService, Usage } from './references';
export class SidecarManager {
    ensureTypes?: () => Promise<void>;
    readonly registry: AttachmentRegistry;
    references?: ReferenceService;
    isActive: () => boolean = () => true;
    private authorized = new Set<string>();
    constructor(private app: App, private settings: AttachmentsLibrarySettings, registry?: AttachmentRegistry) {
        this.registry = registry ?? new AttachmentRegistry(app, settings);

    }
    authorize(path: string): void { this.authorized.add(path); }
    private creationQueue: Promise<unknown> = Promise.resolve();
    getSidecarPath(path: string, reserved = new Set<string>()): string {
        return this.registry.records.get(path)?.indexPath ?? allocateIndexPath(path, this.settings.libraryFolder, occupiedPaths(this.app), reserved);
    }
    async createSidecar(file: TFile, expectedIndexPath?: string, plannedLibraryFolder?: string, allowed = () => true): Promise<CreationResult> {
        const assetPath = file.path;
        const task = this.creationQueue.then(() => {
            if (file.path !== assetPath) throw new Error('Attachment identity changed; preview again.');
            return this.createQueued(file, expectedIndexPath, plannedLibraryFolder, allowed);
        });
        this.creationQueue = task.catch(() => {});
        return task;
    }
    getAttachmentPath(path: string): string { return this.registry.byIndex.get(path)?.assetPath ?? ''; }
    private async createQueued(file: TFile, expectedIndexPath?: string, plannedLibraryFolder?: string, allowed = () => true): Promise<CreationResult> {
        if (!this.isActive() || !allowed() || !isEligiblePath(file.path, this.settings))
            return 'skipped';
        const assetPath = file.path, folder = this.settings.libraryFolder;
        await this.registry.refresh();
        await this.references?.flushDirty();
        const record = this.registry.records.get(file.path);
        if (record?.conflict)
            throw new Error(record.reason);
        if (record?.indexPath)
            return 'existing';
        if (this.app.vault.getFileByPath(file.path) !== file) throw new Error('Attachment identity changed; preview again.');
        if (plannedLibraryFolder !== undefined && plannedLibraryFolder !== this.settings.libraryFolder) throw new Error('Index folder changed; preview again.');
        validateFolder(this.app, this.settings.libraryFolder, this.settings, false);
        let path = expectedIndexPath ?? this.getSidecarPath(file.path);
        if (expectedIndexPath && occupiedPaths(this.app).has(path.toLocaleLowerCase())) throw new Error('Index path occupied; preview again: ' + path);
        await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
        if (!this.registry.mappingComplete) throw new Error('Attachment index inventory is incomplete');
        await this.ensureTypes?.();
        await this.registry.refresh();
        const fresh = this.registry.records.get(file.path);
        if (!this.registry.mappingComplete || fresh?.conflict) throw new Error(fresh?.reason || 'Index inventory incomplete');
        if (fresh?.indexPath) return 'existing';
        const fm = newMetadata(file.path);
        if (!this.isActive() || !allowed()) return 'skipped';
        if (plannedLibraryFolder !== undefined && plannedLibraryFolder !== this.settings.libraryFolder) throw new Error('Index folder changed; preview again.');
        if (this.app.vault.getFileByPath(file.path) !== file) throw new Error('Attachment identity changed; preview again.');
        for (;;) {
            if (!this.isActive() || !allowed()) return 'skipped';
            if (file.path !== assetPath || this.app.vault.getFileByPath(assetPath) !== file) throw new Error('Attachment identity changed; preview again.');
            if (this.settings.libraryFolder !== folder) throw new Error('Index folder changed; preview again.');
            if (!isEligiblePath(assetPath, this.settings)) return 'skipped';
            if (!expectedIndexPath) path = this.getSidecarPath(file.path);
            if (occupiedPaths(this.app).has(path.toLocaleLowerCase())) throw new Error('Index path occupied; preview again: ' + path);
            try {
                await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n${this.preview(file.path)}\n\n## OCR\n\n## 说明\n\n`);
                break;
            } catch (error) {
                if (expectedIndexPath || !occupiedPaths(this.app).has(path.toLocaleLowerCase())) throw error;
                await this.registry.refresh();
                const concurrent = this.registry.records.get(file.path);
                if (!this.registry.mappingComplete || concurrent?.conflict) throw new Error('Index inventory changed.');
                if (concurrent?.indexPath) return 'existing';
            }
        }
        this.authorized.add(path);
        await this.registry.refresh();
        if (this.references) {
            this.references.schedule(path); this.references.invalidateResolution();
            await this.references.flushDirty();
            await this.writeDerived(this.registry.records.get(file.path)!);
        }
        return 'created';
    }

    private preview(path: string): string { return `${PREVIEW_START}\n![[${path}]]\n${PREVIEW_END}`; }
    private async ensureFolder(path: string): Promise<void> {
        if (!this.isActive() || !path || this.app.vault.getAbstractFileByPath(path))
            return;
        try {
            await this.app.vault.createFolder(path);
        }
        catch (error) {
            if (!this.app.vault.getAbstractFileByPath(path))
                throw error;
        }
    }
    private hasUnsavedEditor(file: TFile, text: string): boolean {
        return this.app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.editor.getValue() !== text);
    }
    async patch(record: AttachmentRecord, values: Record<string, unknown>): Promise<boolean> {
        if (!this.isActive() || !record.index || record.conflict)
            return false;
        const text = await this.app.vault.cachedRead(record.index);
        if (this.hasUnsavedEditor(record.index, text)) return false;
        const current = readDocument(text).metadata;
        const stat = { mtime: record.index.stat.mtime, size: record.index.stat.size };
        const changed = Object.keys(values).some(key => JSON.stringify(current[key]) !== JSON.stringify(values[key]));
        if (!changed)
            return false;
        if (!this.isActive())
            return false;
        await this.app.fileManager.processFrontMatter(record.index, (fm: Record<string, unknown>) => {
            if (!this.isActive() || this.app.vault.getFileByPath(record.indexPath!) !== record.index || this.hasUnsavedEditor(record.index, text)) throw new Error('Unsaved index edits or stopped update');
            if (record.index.stat.mtime !== stat.mtime || record.index.stat.size !== stat.size || [...new Set([...Object.keys(values), 'attachment', '_filePath'])].some(key => JSON.stringify(fm[key]) !== JSON.stringify(current[key]))) throw new Error('Index changed; update again after saving');
            Object.assign(fm, values);
        });
        Object.assign(record.metadata, values);
        return true;
    }
    async writeDerived(record: AttachmentRecord, snapshot?: Usage): Promise<boolean> {
        if (!this.settings.initialScanComplete && record.metadata.al_schema !== 2 && !this.authorized.has(record.indexPath ?? ''))
            return false;
        const usage = snapshot ?? this.references?.getUsage(record);
        if (managedIssues(record.metadata).length || this.references?.pending || usage?.reasons.some(reason => /Metadata cache (?:stale|pending)/.test(reason))) return false;
        const values: Record<string, unknown> = { al_usageCount: usage?.count ?? 0, al_usageState: usage?.state ?? this.registry.state(record) ?? 'unknown' };
        if (Object.entries(values).every(([key, value]) => record.metadata[key] === value))
            return false;
        return this.patch(record, values);
    }
    async updateSidecarDates(_file: TFile): Promise<void> { /* User properties are not maintained by the plugin. */ }
    async renameSidecar(oldPath: string, newPath: string): Promise<void> {
        const record = this.registry.records.get(oldPath);
        if (!record?.index || record.conflict)
            return;
        if (this.hasUnsavedEditor(record.index, await this.app.vault.cachedRead(record.index))) throw new Error('Unsaved index edits; save before updating the attachment');
        const other = this.registry.records.get(newPath);
        if (other?.indexPath && other.indexPath !== record.indexPath)
            throw new Error('Destination association conflict');
        const collisions = this.app.vault.getFiles().filter(f => f.path.toLocaleLowerCase() === newPath.toLocaleLowerCase());
        if (collisions.length > 1)
            throw new Error('Destination path collision');
        await this.patch(record, { attachment: `[[${newPath}]]`, _filePath: newPath, _fileType: newPath.split('.').pop() });
        const content = await this.app.vault.cachedRead(record.index);
        const start = content.indexOf(PREVIEW_START), end = content.indexOf(PREVIEW_END, start);
        if (start >= 0 && end >= start) {
            const updated = content.slice(0, start) + this.preview(newPath) + content.slice(end + PREVIEW_END.length);
            if (this.isActive() && updated !== content)
                await this.app.vault.process(record.index, current => { if (!this.isActive() || current !== content || this.hasUnsavedEditor(record.index!, current)) throw new Error('Index changed or has unsaved edits'); return updated; });
        }
        await this.registry.refresh();
    }
    async deleteSidecar(_attachmentPath: string): Promise<void> { await this.registry.refresh(); }
    async setKeep(record: AttachmentRecord, value: boolean): Promise<void> { await this.patch(record, record.metadata.al_schema === 2 ? { keep: value } : { al_keep: value }); }
    private sanitizeTag(raw: string): string { return raw.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}\-_/]/gu, '').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, ''); }
    async sanitizeSidecarTags(): Promise<number> {
        let count = 0;
        for (const record of this.registry.byIndex.values()) {
            const tags = record.metadata[this.settings.tagsPropertyName];
            if (Array.isArray(tags) && await this.patch(record, { [this.settings.tagsPropertyName]: tags.map(t => this.sanitizeTag(String(t))).filter(Boolean) }))
                count++;
        }
        return count;
    }
    async migrateTagsProperty(oldName: string, newName: string): Promise<number> {
        let count = 0;
        if (!oldName || oldName === newName)
            return count;
        for (const record of this.registry.byIndex.values()) {
            if (record.conflict || !record.index || !(oldName in record.metadata) || newName in record.metadata)
                continue;
            await this.app.fileManager.processFrontMatter(record.index, (fm: Record<string, unknown>) => { fm[newName] = fm[oldName]; delete fm[oldName]; });
            count++;
        }
        return count;
    }
}
