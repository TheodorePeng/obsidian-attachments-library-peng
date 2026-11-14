import { App, Platform } from 'obsidian';
import { AttachmentRegistry, linkPath, readDocument } from './registry';
import { galleryViews } from './gallery-destination';
import { OperationStore, assertSaved } from './operation-store';
export interface LegacyCandidate { path: string; assetPath: string; before: string; error?: string; }
export interface LibraryDiscovery { bases: string[]; recognized: string[]; candidates: LegacyCandidate[]; conflicts: string[]; }
export class LibraryRestore {
    blocked = (_path: string): boolean => false;
    isActive = () => true;
    constructor(private app: App, private registry: AttachmentRegistry, private store: OperationStore) {}
    async discover(): Promise<LibraryDiscovery> {
        await this.registry.refresh(true);
        const result: LibraryDiscovery = { bases: [], recognized: [], candidates: [], conflicts: [] };
        for (const file of this.app.vault.getFiles()) {
            if (file.extension === 'base') { try { if (galleryViews(await this.app.vault.read(file)).length) result.bases.push(file.path); } catch { result.conflicts.push(file.path + ': Invalid Base'); } }
            if (file.extension !== 'md') continue;
            try {
                const before = await this.app.vault.read(file), metadata = readDocument(before).metadata;
                if (metadata.al_schema === 1 || metadata.al_schema === 2) { result.recognized.push(file.path); continue; }
                if (typeof metadata._filePath !== 'string' || !linkPath(metadata.attachment)) continue;
                const record = this.registry.byIndex.get(file.path), raw = linkPath(metadata.attachment)!;
                const target = raw === metadata._filePath ? raw : this.app.metadataCache.getFirstLinkpathDest(raw, file.path)?.path;
                const error = target !== metadata._filePath ? 'Attachment association disagrees' : !this.app.vault.getFileByPath(target) ? 'Attachment missing' : record?.conflict && !record.reason.startsWith('Legacy index needs') ? record.reason : undefined;
                result.candidates.push({ path: file.path, assetPath: metadata._filePath, before, error });
            } catch { /* Unrelated malformed notes do not become candidates. */ }
        }
        for (const record of this.registry.records.values()) if (record.conflict && !record.reason.startsWith('Legacy index needs')) result.conflicts.push(record.assetPath + ': ' + record.reason);
        if (!this.registry.mappingComplete) result.conflicts.push('Index inventory incomplete: some managed documents cannot be associated safely.');
        return result;
    }
    async adopt(candidates: LegacyCandidate[]): Promise<void> {
        if (!this.isActive()) throw new Error('Plugin stopped');
        if (!Platform.isDesktopApp) throw new Error('Adopting indexes requires desktop recovery backups.');
        const current = await this.discover();
        for (const candidate of candidates) {
            const fresh = current.candidates.find(item => item.path === candidate.path);
            if (!fresh || fresh.error || fresh.before !== candidate.before) throw new Error('Candidate changed or conflicted: ' + candidate.path);
            await assertSaved(this.app, this.app.vault.getFileByPath(candidate.path)!, this.blocked);
        }
        if (!candidates.length) return;
        await this.store.save('adopt-legacy-indexes', candidates.map(item => ({ path: item.path, content: item.before })), { adds: 'al_schema: 1 only' });
        for (const candidate of candidates) {
            const file = this.app.vault.getFileByPath(candidate.path)!;
            await this.app.vault.process(file, text => {
                if (!this.isActive() || this.blocked(candidate.path) || text !== candidate.before) throw new Error('Index changed: ' + candidate.path);
                return text.replace(/^---(\r?\n)/, '---$1al_schema: 1$1');
            });
        }
        await this.registry.refresh(true);
    }
}
