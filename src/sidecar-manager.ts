import { App, TFile, normalizePath, stringifyYaml } from 'obsidian';
import { AttachmentsLibrarySettings, AttachmentMetadata, DEFAULT_METADATA } from './types';
import { PdfMetadataExtractor } from './pdf-extractor';
import { AttachmentRegistry, AttachmentRecord, PREVIEW_END, PREVIEW_START, readDocument } from './registry';
import { isEligiblePath } from './file-policy';
import type { ReferenceService, Usage } from './references';
export class SidecarManager {
    private pdfExtractor: PdfMetadataExtractor;
    readonly registry: AttachmentRegistry;
    references?: ReferenceService;
    isActive: () => boolean = () => true;
    private authorized = new Set<string>();
    constructor(private app: App, private settings: AttachmentsLibrarySettings, registry?: AttachmentRegistry) {
        this.registry = registry ?? new AttachmentRegistry(app, settings);
        this.pdfExtractor = new PdfMetadataExtractor(app);
    }
    getSidecarPath(path: string): string {
        return this.registry.records.get(path)?.indexPath ?? normalizePath(`${this.settings.libraryFolder}/${path}.md`);
    }
    getAttachmentPath(path: string): string { return this.registry.byIndex.get(path)?.assetPath ?? ''; }
    async createSidecar(file: TFile): Promise<void> {
        if (!this.isActive() || !isEligiblePath(file.path, this.settings))
            return;
        await this.registry.refresh();
        const record = this.registry.records.get(file.path);
        if (record?.conflict)
            throw new Error(record.reason);
        if (record?.indexPath)
            return;
        const path = this.getSidecarPath(file.path);
        if (this.app.vault.getFileByPath(path) || this.app.vault.getFiles().some(f => f.path.toLocaleLowerCase() === path.toLocaleLowerCase()))
            throw new Error('Index path collision: ' + path);
        await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
        const metadata: AttachmentMetadata = { ...DEFAULT_METADATA, tags: [], attachment: `[[${file.path}]]`, title: file.basename, created: this.date(file.stat.ctime), updated: this.date(file.stat.mtime), _fileType: file.extension, _filePath: file.path };
        if (this.settings.enablePdfMetadataExtraction && file.extension === 'pdf') {
            const extracted = await this.pdfExtractor.extract(file);
            if (extracted.title) {
                metadata.title = extracted.title;
                metadata._heuristic = true;
            }
            if (extracted.author) {
                metadata.author = extracted.author;
                metadata._heuristic = true;
            }
            if (extracted.subject)
                metadata.subject = extracted.subject;
            metadata.tags = extracted.keywords.map(tag => this.sanitizeTag(tag)).filter(Boolean);
        }
        const fm: Record<string, unknown> = { ...metadata, al_schema: 1, al_usageCount: 0, al_usageState: 'unknown', al_keep: false };
        if (this.settings.tagsPropertyName !== 'tags') {
            fm[this.settings.tagsPropertyName] = fm.tags;
            delete fm.tags;
        }
        if (!this.isActive())
            return;
        await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n# ${metadata.title}\n\n${this.preview(file.path)}\n\n## OCR\n\n## 说明\n\n`);
        this.authorized.add(path);
        await this.registry.refresh();
        if (this.references) {
            await this.references.refresh([path]);
            await this.writeDerived(this.registry.records.get(file.path)!);
        }
    }
    private date(value: number): string { return new Date(value).toISOString().split('T')[0]; }
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
    async patch(record: AttachmentRecord, values: Record<string, unknown>): Promise<boolean> {
        if (!this.isActive() || !record.index || record.conflict)
            return false;
        const current = readDocument(await this.app.vault.cachedRead(record.index)).metadata;
        const changed = Object.keys(values).some(key => JSON.stringify(current[key]) !== JSON.stringify(values[key]));
        if (!changed)
            return false;
        if (!this.isActive())
            return false;
        await this.app.fileManager.processFrontMatter(record.index, (fm: Record<string, unknown>) => Object.assign(fm, values));
        Object.assign(record.metadata, values);
        return true;
    }
    async writeDerived(record: AttachmentRecord, snapshot?: Usage): Promise<boolean> {
        if (!this.settings.initialScanComplete && !this.authorized.has(record.indexPath ?? ''))
            return false;
        const usage = snapshot ?? this.references?.getUsage(record);
        const values = { al_schema: 1, al_keep: record.metadata.al_keep === true, al_usageCount: usage?.count ?? 0, al_usageState: usage?.state ?? this.registry.state(record) ?? 'unknown' };
        if (Object.entries(values).every(([key, value]) => record.metadata[key] === value))
            return false;
        return this.patch(record, values);
    }
    async updateSidecarDates(file: TFile): Promise<void> {
        const record = this.registry.records.get(file.path);
        if (record && (this.settings.initialScanComplete || this.authorized.has(record.indexPath ?? '')))
            await this.patch(record, { updated: this.date(file.stat.mtime) });
    }
    async renameSidecar(oldPath: string, newPath: string): Promise<void> {
        const record = this.registry.records.get(oldPath);
        if (!record?.index || record.conflict)
            return;
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
                await this.app.vault.modify(record.index, updated);
        }
        await this.registry.refresh();
    }
    async deleteSidecar(_attachmentPath: string): Promise<void> { await this.registry.refresh(); }
    async setKeep(record: AttachmentRecord, value: boolean): Promise<void> { await this.patch(record, { al_keep: value }); }
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
