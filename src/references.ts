import { App, TFile, parseYaml } from 'obsidian';
import { AttachmentRecord, AttachmentRegistry, PREVIEW_END, PREVIEW_START, readDocument } from './registry';
import { UsageState } from './types';
export interface Usage {
    state: UsageState;
    count: number;
    sources: string[];
    indexSources: string[];
    reasons: string[];
}
interface SourceResult {
    targets: Set<string>;
    reasons: string[];
}
export function isRemote(link: string): boolean { return /^(?:[a-z][\w+.-]*:|\/\/)/i.test(link); }
function parseExplicitLinks(text: string): {
    links: string[];
    uncertain: boolean;
} {
    const links: string[] = [];
    let uncertain = false;
    for (const match of text.matchAll(/!?\[\[([^\]|#]+)[^\]]*\]\]/g))
        links.push(match[1]);
    for (const match of text.matchAll(/\]\s*\(/g)) {
        const start = match.index + match[0].length;
        let depth = 1, end = start, escaped = false, angle = false;
        for (; end < text.length; end++) {
            const char = text[end];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '<' && end === start) {
                angle = true;
                continue;
            }
            if (char === '>' && angle) {
                angle = false;
                continue;
            }
            if (angle)
                continue;
            if (char === '(')
                depth++;
            if (char === ')' && --depth === 0)
                break;
        }
        if (depth !== 0) {
            uncertain = true;
            continue;
        }
        let target = text.slice(start, end).trim();
        if (target.startsWith('<')) {
            const close = target.indexOf('>');
            if (close < 0) {
                uncertain = true;
                continue;
            }
            target = target.slice(1, close);
        }
        else
            target = target.replace(/\s+["'][^"']*["']\s*$/, '');
        target = target.replace(/\\([\\() ])/g, '$1');
        if (target)
            links.push(target);
    }
    const definitions = new Map<string, string>();
    for (const match of text.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm))
        definitions.set(match[1].trim().toLocaleLowerCase(), match[2] ?? match[3]);
    for (const match of text.matchAll(/!?\[([^\]]*)\]\[([^\]]*)\]/g)) {
        const target = definitions.get((match[2] || match[1]).trim().toLocaleLowerCase());
        if (target)
            links.push(target);
        else
            uncertain = true;
    }
    for (const match of text.matchAll(/!?\[([^\]]+)\](?!\[|\(|:)/g)) {
        const target = definitions.get(match[1].trim().toLocaleLowerCase());
        if (target)
            links.push(target);
    }
    for (const match of text.matchAll(/<(?:img|audio|video|source|iframe|embed|a)\b[^>]*?\b(?:src|href|srcset)\s*=\s*(["'])(.*?)\1/gi))
        if (!isRemote(match[2]))
            uncertain = true;
    for (const match of text.matchAll(/\b(?:link|image)\(\s*["']([^"']+)["']\s*\)/g))
        links.push(match[1]);
    return { links, uncertain };
}
export function extractExplicitLinks(text: string): string[] { return parseExplicitLinks(text).links; }
export class ReferenceService {
    generation = 0;
    ready = false;
    pending = false;
    private sourceResults = new Map<string, SourceResult>();
    private reverse = new Map<string, Set<string>>();
    private timer?: number;
    private dirty = new Set<string>();
    onRefreshed?: () => Promise<void>;
    private waiting = new Set<string>();
    private cacheSnapshots = new Map<string, {
        text: string;
        cache: unknown;
    }>();
    private changedText = new Map<string, string>();
    markDirty(path: string): void { if (path.endsWith('.md'))
        this.waiting.add(path); this.schedule(path); }
    cacheChanged(path: string, text: string): void { this.waiting.delete(path); this.changedText.set(path, text); this.schedule(path); }
    private tail: Promise<void> = Promise.resolve();
    private queued = 0;
    private disposed = false;
    constructor(private app: App, private registry: AttachmentRegistry) { }
    schedule(path: string): void {
        if (this.disposed)
            return;
        this.dirty.add(path);
        this.pending = true;
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => { const paths = [...this.dirty]; this.dirty.clear(); void this.refresh(paths); }, 300);
    }
    dispose(): void { this.disposed = true; window.clearTimeout(this.timer); this.dirty.clear(); this.onRefreshed = undefined; }
    async refresh(paths?: string[]): Promise<void> {
        if (this.disposed)
            return;
        if (!paths)
            this.dirty.clear();
        else
            for (const path of paths)
                this.dirty.delete(path);
        if (!this.dirty.size)
            window.clearTimeout(this.timer);
        this.queued++;
        this.pending = true;
        const run = this.tail.then(async () => {
            try {
                if (!this.disposed)
                    await this.scan(paths);
            }
            finally {
                this.queued--;
                this.pending = this.queued > 0 || this.dirty.size > 0;
            }
            if (!this.disposed && !this.pending)
                await this.onRefreshed?.();
        });
        this.tail = run.catch(() => { });
        await run;
    }
    private async scan(paths?: string[]): Promise<void> {
        const before = this.signature();
        const sources = this.app.vault.getFiles().filter(f => ['md', 'canvas', 'base'].includes(f.extension));
        const selected = paths ? sources.filter(f => paths.includes(f.path)) : sources;
        if (!paths)
            this.sourceResults.clear();
        else
            for (const path of paths) {
                this.sourceResults.delete(path);
                if (!sources.some(f => f.path === path)) {
                    this.waiting.delete(path);
                    this.cacheSnapshots.delete(path);
                    this.changedText.delete(path);
                }
            }
        for (const source of selected) {
            try {
                this.sourceResults.set(source.path, await this.scanSource(source));
            }
            catch {
                this.sourceResults.set(source.path, { targets: new Set(), reasons: ['Cannot read source: ' + source.path] });
            }
        }
        this.reverse.clear();
        for (const [path, result] of this.sourceResults)
            for (const target of result.targets) {
                const set = this.reverse.get(target) ?? new Set();
                set.add(path);
                this.reverse.set(target, set);
            }
        this.ready = true;
        if (before !== this.signature())
            this.generation++;
    }
    private signature(): string { return JSON.stringify([...this.sourceResults].map(([p, r]) => [p, [...r.targets].sort(), r.reasons]).sort()); }
    private async scanSource(file: TFile): Promise<SourceResult> {
        const result: SourceResult = { targets: new Set(), reasons: [] };
        const text = await this.app.vault.cachedRead(file);
        const add = (raw: string) => {
            if (isRemote(raw) || raw.startsWith('#'))
                return;
            let link: string;
            try {
                link = decodeURIComponent(raw.split('#')[0]);
            }
            catch {
                result.reasons.push('Invalid local link: ' + file.path);
                return;
            }
            const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
            if (target)
                result.targets.add(target.path);
            else if ([...this.registry.records.values()].some(r => [r.assetPath, r.indexPath].some(p => p && (p === link || p.split('/').pop() === link || p.toLocaleLowerCase() === link.toLocaleLowerCase()))))
                result.reasons.push('Unresolved candidate link in ' + file.path + ': ' + link);
        };
        const addExplicit = (value: string) => { const parsed = parseExplicitLinks(value); for (const link of parsed.links)
            add(link); if (parsed.uncertain)
            result.reasons.push('Unparsed Markdown link: ' + file.path); };
        if (file.extension === 'canvas') {
            const canvas: unknown = JSON.parse(text);
            if (!canvas || typeof canvas !== 'object' || !Array.isArray((canvas as {
                nodes?: unknown;
            }).nodes))
                throw new Error('Invalid canvas');
            for (const node of (canvas as {
                nodes: {
                    type?: string;
                    file?: string;
                    text?: string;
                }[];
            }).nodes) {
                if (node.type === 'file' && typeof node.file === 'string')
                    add(node.file);
                if (node.type === 'text' && typeof node.text === 'string')
                    addExplicit(node.text);
            }
        }
        else if (file.extension === 'base') {
            if (!text.trim())
                return result;
            const parsed: unknown = parseYaml(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                throw new Error('Invalid Base');
            addExplicit(text);
            const withoutConstants = text.replace(/\b(?:link|image)\(\s*["'][^"']*["']\s*\)/g, '');
            if (/\b(?:link|image)\(/.test(withoutConstants))
                result.reasons.push('Dynamic Base link: ' + file.path);
        }
        else {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) {
                result.reasons.push('Metadata cache pending: ' + file.path);
                return result;
            }
            const previous = this.cacheSnapshots.get(file.path);
            if (this.waiting.has(file.path) || (this.changedText.has(file.path) && this.changedText.get(file.path) !== text) || (previous && previous.text !== text && previous.cache === cache && this.changedText.get(file.path) !== text))
                result.reasons.push('Metadata cache stale: ' + file.path);
            this.cacheSnapshots.set(file.path, { text, cache });
            const record = this.registry.byIndex.get(file.path);
            const start = text.indexOf(PREVIEW_START), end = text.indexOf(PREVIEW_END, start);
            const embeds = cache.embeds ?? [];
            let legacyEmbed: typeof embeds[number] | undefined;
            if (record && start < 0) {
                const own = embeds.filter(e => this.app.metadataCache.getFirstLinkpathDest(e.link, file.path)?.path === record.assetPath);
                if (own.length === 1 && readDocument(text).body.split('\n').some(line => line.trim() === own[0].original))
                    legacyEmbed = own[0];
                else if (own.length)
                    result.reasons.push('Ambiguous legacy preview: ' + file.path);
            }
            for (const link of [...(cache.links ?? []), ...embeds]) {
                const offset = link.position?.start.offset;
                if (record && ((offset !== undefined && start >= 0 && end >= start && offset >= start && offset <= end + PREVIEW_END.length) || link === legacyEmbed))
                    continue;
                add(link.link);
            }
            let freshBody = readDocument(text).body.replace(/<!-- alp:preview:start -->[\s\S]*?<!-- alp:preview:end -->/g, '');
            if (legacyEmbed)
                freshBody = freshBody.split('\n').filter(line => line.trim() !== legacyEmbed.original).join('\n');
            addExplicit(freshBody);
            const freshMetadata = { ...readDocument(text).metadata };
            if (record)
                delete freshMetadata.attachment;
            const visit = (value: unknown): void => { if (typeof value === 'string')
                addExplicit(value);
            else if (Array.isArray(value))
                value.forEach(visit);
            else if (value && typeof value === 'object')
                Object.values(value).forEach(visit); };
            visit(freshMetadata);
            for (const link of cache.frontmatterLinks ?? []) {
                if (record && (link.key === 'attachment' || link.key.startsWith('attachment.')) && (link.link.split('#')[0] === record.assetPath || this.app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path === record.assetPath))
                    continue;
                add(link.link);
            }
        }
        return result;
    }
    getUsage(record: AttachmentRecord): Usage {
        const direct = [...(this.reverse.get(record.assetPath) ?? [])];
        const indexSources = record.indexPath ? [...(this.reverse.get(record.indexPath) ?? [])] : [];
        const sources = [...new Set([...direct, ...indexSources])].sort();
        const reasons = [...this.sourceResults.values()].flatMap(r => r.reasons);
        const special = this.registry.state(record);
        const state = special ?? (!this.ready || this.pending || reasons.length ? 'unknown' : sources.length ? 'used' : 'orphan');
        return { state, count: sources.length, sources, indexSources: indexSources.sort(), reasons };
    }
}
