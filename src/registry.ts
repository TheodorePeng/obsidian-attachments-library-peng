import { managedIssues } from './managed-properties';
import { App, TFile, normalizePath, parseYaml } from 'obsidian';
import { AttachmentsLibrarySettings, UsageState } from './types';
import { isEligiblePath } from './file-policy';
export const PREVIEW_START = '<!-- alp:preview:start -->';
export const PREVIEW_END = '<!-- alp:preview:end -->';
export interface AttachmentRecord {
    assetPath: string;
    indexPath?: string;
    indexPaths?: string[];
    asset?: TFile;
    index?: TFile;
    metadata: Record<string, unknown>;
    conflict: boolean;
    reason: string;
}
export function readDocument(content: string): {
    metadata: Record<string, unknown>;
    body: string;
} {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match)
        return { metadata: {}, body: content };
    const parsed: unknown = parseYaml(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Invalid frontmatter');
    return { metadata: parsed as Record<string, unknown>, body: content.slice(match[0].length) };
}
export function linkPath(value: unknown): string | null {
    if (typeof value !== 'string')
        return null;
    const match = /^!?\[\[([^\]|#]+)(?:[^\]]*)\]\]$/.exec(value.trim());
    return match ? normalizePath(match[1]) : null;
}
export class AttachmentRegistry {
    records = new Map<string, AttachmentRecord>();
    byIndex = new Map<string, AttachmentRecord>();
    generation = 0;
    private documents = new Map<string, { file: TFile; token: string; metadata: Record<string, unknown>; failed: boolean }>();
    private dirty = new Set<string>();
    mappingComplete = true;
    metadataSnapshot(): [string, Record<string, unknown>][] { return [...this.documents].map(([path, entry]) => [path, entry.metadata]); }
    invalidate(path: string): void { this.dirty.add(path); }
    private knownIndexes = new WeakSet<TFile>();
    constructor(private app: App, public settings: AttachmentsLibrarySettings) { }
    async refresh(full = false): Promise<void> {
        if (full) this.documents.clear();
        this.mappingComplete = true;
        const records = new Map<string, AttachmentRecord>();
        const byIndex = new Map<string, AttachmentRecord>();
        const files = this.app.vault.getFiles();
        const folded = new Map<string, string[]>();
        for (const file of files) {
            const key = file.path.toLocaleLowerCase();
            folded.set(key, [...(folded.get(key) ?? []), file.path]);
            if (isEligiblePath(file.path, this.settings))
                records.set(file.path, this.record(file.path, file));
        }
        const live = new Set(files.filter(f => f.extension.toLowerCase() === 'md').map(f => f.path));
        for (const path of this.documents.keys()) if (!live.has(path)) this.documents.delete(path);
        for (const index of files.filter(f => f.extension.toLowerCase() === 'md')) {
            let token: string;
            try { token = JSON.stringify([index.stat.mtime, index.stat.size, this.app.metadataCache.getFileCache(index)?.frontmatter]); } catch { token = JSON.stringify([index.stat.mtime, index.stat.size, 'cache-unavailable']); }
            let entry = this.documents.get(index.path);
            if (!entry || entry.file !== index || entry.token !== token || this.dirty.has(index.path)) {
                let content: string | undefined;
                try { content = await this.app.vault.cachedRead(index); entry = { file: index, token, metadata: readDocument(content).metadata, failed: false }; }
                catch { entry = { file: index, token, metadata: entry?.metadata ?? {}, failed: content === undefined || /(?:_filePath|al_schema)\s*:/.test(content) }; }
                this.documents.set(index.path, entry);
            }
            this.dirty.delete(index.path);
            if (entry.failed) this.mappingComplete = false;
            const metadata = entry.metadata;
            const inferredPath = typeof metadata._filePath === 'string' && metadata._filePath ? metadata._filePath : metadata.al_schema === 2 ? linkPath(metadata.attachment) : null;
            if (!inferredPath) { if (metadata.al_schema === 2) this.mappingComplete = false; continue; }
            if (!index.path.startsWith(this.settings.libraryFolder + '/') && metadata.al_schema !== 1 && metadata.al_schema !== 2 && !this.settings.legacyIndexPaths?.includes(index.path) && !this.knownIndexes.has(index))
                continue;
            const assetPath = normalizePath(inferredPath);
            const raw = linkPath(metadata.attachment);
            if (!raw && metadata.al_schema !== 2) continue;
            // A full attachment path remains authoritative when Obsidian falls
            // back to a same-named Markdown index after the binary is removed.
            const resolved = !raw || raw === assetPath ? assetPath : this.app.metadataCache.getFirstLinkpathDest(raw, index.path)?.path ?? raw;
            const existing = records.get(assetPath);
            const record = existing ?? this.record(assetPath, this.app.vault.getFileByPath(assetPath) ?? undefined);
            if (existing?.indexPath) {
                record.conflict = true;
                record.reason = 'Multiple index documents';
            }
            if (resolved !== assetPath) {
                record.conflict = true;
                record.reason = 'attachment and _filePath disagree';
                const other = records.get(resolved) ?? this.record(resolved, this.app.vault.getFileByPath(resolved) ?? undefined);
                other.conflict = true;
                other.reason = record.reason;
                records.set(resolved, other);
            }
            record.indexPaths ??= [];
            record.indexPaths.push(index.path);
            record.indexPath ??= index.path;
            record.index ??= index;
            record.metadata = metadata;
            const issues = managedIssues(metadata);
            if (entry.failed || issues.length) { record.conflict = true; record.reason = entry.failed ? 'Index cannot be read safely' : issues.join('; '); }
            records.set(assetPath, record);
            byIndex.set(index.path, record);
            this.knownIndexes.add(index);
        }
        for (const record of records.values()) {
            if ((folded.get(record.assetPath.toLocaleLowerCase())?.length ?? 0) > 1 ||
                (record.indexPath && (folded.get(record.indexPath.toLocaleLowerCase())?.length ?? 0) > 1)) {
                record.conflict = true;
                record.reason = 'Case-insensitive path collision';
            }
        }
        const signature = (map: Map<string, AttachmentRecord>) => JSON.stringify([...map].map(([p, r]) => [p, r.indexPath, r.conflict, !!r.asset]));
        if (signature(this.records) !== signature(records))
            this.generation++;
        this.records = records;
        this.byIndex = byIndex;
    }
    private record(assetPath: string, asset?: TFile): AttachmentRecord {
        return { assetPath, asset, metadata: {}, conflict: false, reason: '' };
    }
    state(record: AttachmentRecord): UsageState | null {
        if (record.conflict)
            return 'conflict';
        if (!record.asset)
            return 'missing';
        if (!isEligiblePath(record.assetPath, this.settings))
            return 'excluded';
        return null;
    }
}
