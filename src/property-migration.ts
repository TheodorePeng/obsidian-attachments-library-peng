import { App, TFile, parseYaml } from 'obsidian';
import { AttachmentRegistry, readDocument } from './registry';
import { migrationContent } from './managed-properties';
import { assertSaved, fingerprint, OperationStore } from './operation-store';
export interface MigrationItem { path: string; assetPath: string; file: TFile; original: string; updated: string; hash: string; changes: string[]; dependencies: string[]; error?: string; cleanEmpty: boolean; }
function hasDynamicProperty(value: unknown, seen = new Set<object>()): boolean {
    if (typeof value === 'string') return [...value.matchAll(/\bnote\s*\[([^\]]*)\]/g)].some(match => !/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(match[1].trim()));
    if (!value || typeof value !== 'object') return false;
    if (seen.has(value)) return true;
    seen.add(value);
    return Object.values(value).some(child => hasDynamicProperty(child, seen));
}
/** Migration remains explicit; a normal update never invokes this service. */
export class PropertyMigration {
    blocked = (_path: string): boolean => false;
    isActive = (): boolean => true;
    constructor(private app: App, private registry: AttachmentRegistry, private store: OperationStore) {}
    async preview(paths: string[], cleanEmpty = true): Promise<MigrationItem[]> {
        await this.registry.refresh();
        const bases: { path: string; text: string; unknown: boolean }[] = [];
        for (const file of this.app.vault.getFiles().filter(f => f.extension === 'base')) {
            try { const text = await this.app.vault.cachedRead(file); const config: unknown = parseYaml(text); if (!config || typeof config !== 'object' || Array.isArray(config) || ('views' in config && !Array.isArray(config.views))) throw new Error('Invalid Base configuration'); bases.push({ path: file.path, text, unknown: hasDynamicProperty(config) }); }
            catch { bases.push({ path: file.path, text: '', unknown: true }); }
        }
        const result: MigrationItem[] = [];
        for (const path of [...new Set(paths)]) {
            const file = this.app.vault.getFileByPath(path), record = this.registry.byIndex.get(path);
            if (!file || !record) continue;
            const item: MigrationItem = { path, assetPath: record.assetPath, file, original: '', updated: '', hash: '', changes: [], dependencies: [], cleanEmpty };
            result.push(item);
            try {
                if (record.conflict) throw new Error(record.reason);
                item.original = await this.app.vault.read(file); item.hash = fingerprint(item.original);
                const old = readDocument(item.original).metadata;
                if (old.al_schema === 2) { item.updated = item.original; item.changes.push('Already schema 2; user properties unchanged'); continue; }
                const keys = ['source', 'al_keep', 'title', 'status', '_heuristic', 'author', 'subject', 'genre', 'notes', 'created', 'updated', 'tags'].filter(key => key in old);
                item.dependencies = bases.filter(base => base.unknown || keys.some(key => new RegExp('(?:^|[^a-zA-Z0-9_])' + key + '(?:$|[^a-zA-Z0-9_])', 'i').test(base.text))).map(base => base.path);
                item.updated = migrationContent(item.original, record.assetPath, cleanEmpty, !!item.dependencies.length);
                const next = readDocument(item.updated).metadata;
                item.changes = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key])).map(key => key + ': ' + JSON.stringify(old[key]) + ' → ' + JSON.stringify(next[key]));
                if (item.dependencies.length) item.changes.push('Legacy fields retained: Base dependencies need manual review');
                if (readDocument(item.updated).body !== readDocument(item.original).body) item.changes.push('Append Legacy metadata; preserve original body and OCR');
            } catch (error) { item.error = error instanceof Error ? error.message : 'Cannot preview'; }
        }
        return result;
    }
    async apply(items: MigrationItem[]): Promise<string[]> {
        // Refuse the entire run if Base dependencies changed after the preview.
        const fresh = await this.preview(items.map(item => item.path), items[0]?.cleanEmpty ?? true);
        const results: string[] = [];
        const directory = await this.store.save('property-migration-preview', items.filter(i => !i.error && i.original !== i.updated).map(i => ({ path: i.path, content: i.original })), items.map(i => ({ path: i.path, changes: i.changes, dependencies: i.dependencies, error: i.error })));
        for (const item of items) {
            if (!this.isActive()) { results.push('Stopped; remaining files unchanged'); break; }
            try {
                if (item.error) throw new Error(item.error);
                if (item.original === item.updated) { results.push('Unchanged: ' + item.path); continue; }
                const checked = fresh.find(i => i.path === item.path);
                if (!checked || checked.error || checked.hash !== item.hash || checked.updated !== item.updated) throw new Error('Index or Base dependencies changed; preview again');
                const file = this.app.vault.getFileByPath(item.path);
                if (file !== item.file || !file) throw new Error('Index identity changed');
                await assertSaved(this.app, file, this.blocked);
                await this.app.vault.process(file, current => {
                    if (!this.isActive() || this.blocked(item.path) || fingerprint(current) !== item.hash) throw new Error('Index changed or protected');
                    return item.updated;
                });
                this.registry.invalidate(item.path);
                results.push('Migrated: ' + item.path);
            } catch (error) { results.push('Skipped: ' + item.path + ' — ' + (error instanceof Error ? error.message : 'Operation failed')); }
        }
        await this.store.save('property-migration-result', [], { backup: directory, results });
        await this.registry.refresh(); return results;
    }
}
