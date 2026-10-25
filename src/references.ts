import { App, TFile, parseYaml } from 'obsidian';
import { AttachmentRecord, AttachmentRegistry, PREVIEW_END, PREVIEW_START, readDocument } from './registry';
import { UsageState } from './types';
import { parseMarkdownLinks, externalLink, TextRange } from './markdown-links';
import { analyzeBaseExpressions } from './base-formulas';
export interface ReferenceOccurrence {
    sourcePath: string;
    targetPath: string;
    kind: 'link' | 'embed' | 'property' | 'canvas' | 'base';
    line?: number;
    property?: string;
    nodeId?: string;
    formula?: string;
}
export interface ReferenceIssue { sourcePath: string; reason: string; affectedPaths: string[] | null; }
export interface Usage {
    state: UsageState; count: number; sources: string[]; indexSources: string[]; reasons: string[];
    assetSources: string[]; assetCheckComplete: boolean; indexCheckComplete: boolean;
    occurrences: ReferenceOccurrence[]; issues: ReferenceIssue[]; excluded: ReferenceOccurrence[];
}
interface SourceResult { targets: Set<string>; occurrences: ReferenceOccurrence[]; issues: ReferenceIssue[]; excluded: ReferenceOccurrence[]; }
export const isRemote = externalLink;
export function extractExplicitLinks(text: string): string[] { return parseMarkdownLinks(text).links.map(link => link.link); }
export class ReferenceService {
    generation = 0; ready = false; pending = false;
    onRefreshed?: () => Promise<void>;
    private sourceResults = new Map<string, SourceResult>();
    private reverse = new Map<string, Set<string>>();
    private metadata = new Map<string, Record<string, unknown>>();
    private parsed = new Map<string, { text: string; result: ReturnType<typeof parseMarkdownLinks> }>();
    private dirty = new Set<string>(); private waiting = new Set<string>();
    private cacheSnapshots = new Map<string, { text: string; cache: unknown }>();
    private changedText = new Map<string, string>();
    private timer?: number; private tail: Promise<void> = Promise.resolve(); private queued = 0; private disposed = false;
    constructor(private app: App, private registry: AttachmentRegistry) {}
    markDirty(path: string): void { if (path.endsWith('.md')) this.waiting.add(path); this.schedule(path); }
    cacheChanged(path: string, text: string): void { this.waiting.delete(path); this.changedText.set(path, text); this.schedule(path); }
    schedule(path: string): void {
        if (this.disposed) return;
        this.dirty.add(path); this.pending = true; window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => { const paths = [...this.dirty]; this.dirty.clear(); void this.refresh(paths); }, 300);
    }
    dispose(): void { this.disposed = true; window.clearTimeout(this.timer); this.dirty.clear(); this.onRefreshed = undefined; }
    async refresh(paths?: string[]): Promise<void> {
        if (this.disposed) return;
        if (!paths) this.dirty.clear(); else paths.forEach(path => this.dirty.delete(path));
        if (!this.dirty.size) window.clearTimeout(this.timer);
        this.queued++; this.pending = true;
        const run = this.tail.then(async () => {
            try { if (!this.disposed) await this.scan(paths); }
            finally { this.queued--; this.pending = this.queued > 0 || this.dirty.size > 0; }
            if (!this.disposed && !this.pending) await this.onRefreshed?.();
        });
        this.tail = run.catch(() => {}); await run;
    }
    private signature(): string {
        return JSON.stringify([...this.sourceResults].map(([p, r]) => [p, [...r.targets].sort(), r.issues]).sort());
    }
    private async scan(paths?: string[]): Promise<void> {
        const before = this.signature();
        const sources = this.app.vault.getFiles().filter(f => ['md', 'canvas', 'base'].includes(f.extension));
        const alive = new Set(sources.map(f => f.path));
        for (const path of this.metadata.keys()) if (!alive.has(path)) this.metadata.delete(path);
        for (const path of this.sourceResults.keys()) if (!alive.has(path)) {
            this.sourceResults.delete(path); this.waiting.delete(path); this.changedText.delete(path); this.cacheSnapshots.delete(path); this.parsed.delete(path);
        }
        // Base formulas depend on row properties, so any Markdown change refreshes Base analysis.
        const refreshBases = !paths || paths.some(p => p.endsWith('.md'));
        const selected = sources.filter(f => !paths || paths.includes(f.path) || (refreshBases && f.extension === 'base'));
        if (!paths) { this.sourceResults.clear(); this.metadata.clear(); }
        selected.sort((a, b) => Number(a.extension === 'base') - Number(b.extension === 'base'));
        for (const file of selected) {
            try { this.sourceResults.set(file.path, await this.scanSource(file)); }
            catch { this.sourceResults.set(file.path, { targets: new Set(), occurrences: [], excluded: [], issues: [{ sourcePath: file.path, reason: 'Cannot read or parse source: ' + file.path, affectedPaths: null }] }); }
        }
        this.reverse.clear();
        for (const [path, result] of this.sourceResults) for (const target of result.targets) {
            const set = this.reverse.get(target) ?? new Set<string>(); set.add(path); this.reverse.set(target, set);
        }
        this.ready = true; if (before !== this.signature()) this.generation++;
    }
    private parse(text: string, key: string): ReturnType<typeof parseMarkdownLinks> {
        const previous = this.parsed.get(key); if (previous?.text === text) return previous.result;
        const result = parseMarkdownLinks(text); this.parsed.set(key, { text, result }); return result;
    }
    private async scanSource(file: TFile): Promise<SourceResult> {
        const result: SourceResult = { targets: new Set(), occurrences: [], issues: [], excluded: [] };
        const text = await this.app.vault.cachedRead(file);
        const issue = (reason: string, affectedPaths: string[] | null = null) => result.issues.push({ sourcePath: file.path, reason, affectedPaths });
        const add = (raw: string, location: Partial<ReferenceOccurrence> = {}, sourceContext = file.path, excluded = false) => {
            if (isRemote(raw) || raw.startsWith('#')) return;
            if (/^(file|obsidian):/i.test(raw)) { issue('Unresolved local application URL: ' + file.path); return; }
            let link: string; try { link = decodeURIComponent(raw.split('#')[0]); } catch { issue('Invalid local link: ' + file.path); return; }
            const target = this.app.metadataCache.getFirstLinkpathDest(link, sourceContext);
            if (target) {
                const occurrence: ReferenceOccurrence = { sourcePath: file.path, targetPath: target.path, kind: 'link', ...location };
                if (excluded) result.excluded.push(occurrence);
                else { result.targets.add(target.path); result.occurrences.push(occurrence); }
            } else {
                const affected = [...this.registry.records.values()].flatMap(r => [r.assetPath, ...(r.indexPaths ?? (r.indexPath ? [r.indexPath] : []))]).filter(p => p === link || p.split('/').pop()?.toLowerCase() === link.split('/').pop()?.toLowerCase());
                if (affected.length) issue('Unresolved candidate link: ' + link, [...new Set(affected)]);
            }
        };
        const explicit = (value: string, key: string, location: Partial<ReferenceOccurrence> = {}) => {
            const parsed = this.parse(value, key);
            for (const link of parsed.links) add(link.link, { kind: link.kind, line: link.line, ...location });
            if (parsed.uncertain) issue('Unsupported local HTML resource: ' + file.path);
        };
        if (file.extension === 'canvas') {
            const canvas = JSON.parse(text) as { nodes?: { id?: string; type?: string; file?: string; text?: string }[] };
            if (!Array.isArray(canvas?.nodes)) throw new Error('Invalid Canvas');
            for (const node of canvas.nodes) {
                if (node.type === 'file' && typeof node.file === 'string') add(node.file, { kind: 'canvas', nodeId: node.id });
                if (node.type === 'text' && typeof node.text === 'string') explicit(node.text, file.path + ':' + node.id, { kind: 'canvas', nodeId: node.id });
            }
        } else if (file.extension === 'base') {
            if (!text.trim()) return result;
            const config = parseYaml(text) as Record<string, unknown>;
            if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid Base');
            const formulas: Record<string, unknown> = {};
            if (config.formulas && typeof config.formulas === 'object') Object.assign(formulas, config.formulas);
            // Compatibility for explicit standalone constants outside the standard formulas mapping.
            for (const [key, value] of Object.entries(config)) if (!['views', 'filters', 'properties', 'summaries', 'formulas'].includes(key) && typeof value === 'string') {
                if (/\b(?:link|image|file)\s*\(/.test(value)) formulas[key] = value;
                else explicit(value, file.path + ':' + key, { kind: 'base', formula: key });
            }
            const roots = Object.keys(formulas).filter(key => typeof formulas[key] === 'string' && /\b(?:link|image|file)\s*\(/.test(formulas[key]));
            const analysis = analyzeBaseExpressions(formulas, [...this.metadata].map(([path, properties]) => ({ path, properties })), roots);
            for (const target of analysis.links) add(target.target, { kind: 'base', formula: target.formula }, target.rowPath ?? file.path);
            for (const problem of analysis.issues) issue('Base formula ' + problem.formula + ': ' + problem.reason);
        } else {
            const document = readDocument(text); this.metadata.set(file.path, document.metadata);
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) issue('Metadata cache pending: ' + file.path);
            const previous = this.cacheSnapshots.get(file.path);
            if (this.waiting.has(file.path) || (this.changedText.has(file.path) && this.changedText.get(file.path) !== text) || (previous && previous.text !== text && previous.cache === cache && this.changedText.get(file.path) !== text)) issue('Metadata cache stale: ' + file.path);
            this.cacheSnapshots.set(file.path, { text, cache });
            const record = this.registry.byIndex.get(file.path);
            const ranges: TextRange[] = [{ from: 0, to: text.length - document.body.length }];
            const start = text.indexOf(PREVIEW_START), end = text.indexOf(PREVIEW_END, start);
            if (record && start >= 0 && end >= start) ranges.push({ from: start, to: end + PREVIEW_END.length });
            let legacy: { original: string; link: string } | undefined;
            if (record && start < 0) {
                const own = (cache?.embeds ?? []).filter(e => this.app.metadataCache.getFirstLinkpathDest(e.link, file.path)?.path === record.assetPath);
                if (own.length === 1 && document.body.split('\n').some(line => line.trim() === own[0].original)) {
                    legacy = own[0]; const offset = text.indexOf(legacy.original, ranges[0].to); ranges.push({ from: offset, to: offset + legacy.original.length });
                } else if (own.length) issue('Ambiguous legacy preview: ' + file.path, [record.assetPath]);
            }
            const masked = text.split('').map((char, offset) => ranges.some(range => offset >= range.from && offset < range.to) && char !== '\n' ? ' ' : char).join('');
            const parsed = this.parse(masked, file.path);
            for (const link of parsed.links) add(link.link, { kind: link.kind, line: link.line });
            if (parsed.uncertain) issue('Unsupported local HTML resource: ' + file.path);
            for (const link of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
                const offset = link.position?.start.offset;
                if (link === legacy || (offset !== undefined && [...ranges, ...parsed.ignored].some(range => offset >= range.from && offset < range.to))) continue;
                add(link.link, { kind: (cache?.embeds ?? []).includes(link) ? 'embed' : 'link', line: link.position?.start.line !== undefined ? link.position.start.line + 1 : undefined });
            }
            if (record) {
                result.excluded.push({ sourcePath: file.path, targetPath: record.assetPath, kind: 'property', property: 'attachment' });
                if ((start >= 0 && end >= start) || legacy) result.excluded.push({ sourcePath: file.path, targetPath: record.assetPath, kind: 'embed' });
            }
            const visit = (value: unknown, property: string): void => {
                if (record && property === 'attachment') return;
                if (typeof value === 'string') explicit(value, file.path + ':' + property, { kind: 'property', property });
                else if (Array.isArray(value)) value.forEach((v, i) => visit(v, property + '.' + i));
                else if (value && typeof value === 'object') for (const [key, nested] of Object.entries(value)) visit(nested, property + '.' + key);
            };
            for (const [key, value] of Object.entries(document.metadata)) visit(value, key);
            for (const link of cache?.frontmatterLinks ?? []) {
                if (record && (link.key === 'attachment' || link.key.startsWith('attachment.')) && (link.link.split('#')[0] === record.assetPath || this.app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path === record.assetPath)) continue;
                const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
                if (!result.occurrences.some(o => o.kind === 'property' && o.property === link.key && o.targetPath === target?.path)) add(link.link, { kind: 'property', property: link.key });
            }
        }
        return result;
    }
    getUsage(record: AttachmentRecord): Usage {
        const assetSources = [...(this.reverse.get(record.assetPath) ?? [])].sort();
        const indexes = record.indexPaths ?? (record.indexPath ? [record.indexPath] : []);
        const indexSources = [...new Set(indexes.flatMap(path => [...(this.reverse.get(path) ?? [])]))].sort();
        const sources = [...new Set([...assetSources, ...indexSources])].sort();
        const paths = [record.assetPath, ...indexes];
        const allIssues = [...this.sourceResults.values()].flatMap(r => r.issues);
        const issues = allIssues.filter(i => i.affectedPaths === null || i.affectedPaths.some(p => paths.includes(p)));
        const assetCheckComplete = this.ready && !this.pending && !issues.some(i => i.affectedPaths === null || i.affectedPaths.includes(record.assetPath));
        const indexCheckComplete = this.ready && !this.pending && !issues.some(i => i.affectedPaths === null || i.affectedPaths.some(p => indexes.includes(p)));
        const state = this.registry.state(record) ?? (sources.length ? 'used' : assetCheckComplete && indexCheckComplete ? 'orphan' : 'unknown');
        const occurrences = [...this.sourceResults.values()].flatMap(r => r.occurrences).filter(o => paths.includes(o.targetPath));
        const unique = [...new Map(occurrences.map(o => [JSON.stringify(o), o])).values()];
        return { state, count: sources.length, sources, indexSources, assetSources, assetCheckComplete, indexCheckComplete, occurrences: unique, issues, reasons: [...issues.map(i => i.reason), ...(!this.ready || this.pending ? ['Reference scan pending'] : [])], excluded: [...this.sourceResults.values()].flatMap(r => r.excluded).filter(o => paths.includes(o.targetPath)) };
    }
    safetySnapshot(record: AttachmentRecord, mode: 'metadata-only' | 'pair'): string {
        const usage = this.getUsage(record);
        return JSON.stringify({ assetPath: record.assetPath, indexPaths: record.indexPaths ?? [record.indexPath], conflict: record.conflict, keep: record.metadata.al_keep === true, indexSources: usage.indexSources, indexComplete: usage.indexCheckComplete, ...(mode === 'pair' ? { assetSources: usage.assetSources, assetComplete: usage.assetCheckComplete } : {}), issues: usage.issues.filter(i => i.affectedPaths === null || i.affectedPaths.some(p => mode === 'pair' ? p === record.assetPath || (record.indexPaths ?? [record.indexPath]).includes(p) : (record.indexPaths ?? [record.indexPath]).includes(p))).map(i => ({ sourcePath: i.sourcePath, reason: i.reason, paths: i.affectedPaths })) });
    }
}
