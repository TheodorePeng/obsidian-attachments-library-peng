import { App, MarkdownView, TFile, stringifyYaml } from 'obsidian';
import { AttachmentRegistry, readDocument } from './registry';
import { SidecarManager } from './sidecar-manager';
import { ReferenceService } from './references';
import { isEligiblePath } from './file-policy';
import { managedIssues, MANAGED_TYPES } from './managed-properties';
import { parseMarkdownLinks } from './markdown-links';
import { selectAttachmentTarget } from './target-selection';
import { chooseItem } from './choices';
import { assertSaved, fingerprint, OperationStore } from './operation-store';
export interface UpdateItem { assetPath: string; indexPath?: string; kind: 'create' | 'repair' | 'unchanged' | 'conflict' | 'excluded'; changes: Record<string, unknown>; reason: string; hash?: string; file?: TFile; }
export class AttachmentUpdates {
    blocked = (_path: string): boolean => false;
    isActive = (): boolean => true;
    constructor(private app: App, private registry: AttachmentRegistry, private sidecars: SidecarManager, private references: ReferenceService, private store: OperationStore) {}
    async current(): Promise<string | null> {
        await this.registry.refresh();
        const active = this.app.workspace.getActiveFile();
        if (!active) return null;
        const record = this.registry.byIndex.get(active.path);
        const input: Parameters<typeof selectAttachmentTarget>[0] = { activeAttachment: isEligiblePath(active.path, this.registry.settings) ? active.path : undefined, activeIndexAttachment: record?.assetPath, candidates: [] };
        if (!input.activeAttachment && !input.activeIndexAttachment && active.extension.toLowerCase() === 'md') {
            const view = this.app.workspace.getActiveViewOfType?.(MarkdownView);
            const editor = view?.file === active && view.getMode() === 'source' ? view.editor : undefined;
            const text = editor?.getValue() ?? await this.app.vault.cachedRead(active);
            if (editor) input.cursorOffset = editor.posToOffset(editor.getCursor());
            input.candidates = parseMarkdownLinks(text).links.flatMap(link => {
                const file = this.app.metadataCache.getFirstLinkpathDest(link.link.split('#')[0], active.path);
                if (!file || !isEligiblePath(file.path, this.registry.settings)) return [];
                const tail = text.slice(link.offset).match(/^(?:!?\[\[[^\]]*\]\]|!?\[[^\]]*\]\([^)]*\))/)?.[0].length ?? 1;
                return [{ path: file.path, from: link.offset, to: link.offset + tail }];
            });
        }
        const result = selectAttachmentTarget(input);
        return result.kind === 'target' ? result.path : result.kind === 'choose' ? chooseItem(this.app, 'Choose an attachment', result.paths) : null;
    }
    async preview(paths: string[]): Promise<UpdateItem[]> {
        await this.registry.refresh(); await this.references.flushDirty();
        const items: UpdateItem[] = [];
        for (const path of [...new Set(paths)]) {
            const record = this.registry.records.get(path);
            const item: UpdateItem = { assetPath: path, indexPath: record?.indexPath, kind: 'unchanged', changes: {}, reason: '' };
            items.push(item);
            if (!isEligiblePath(path, this.registry.settings)) { item.kind = 'excluded'; item.reason = 'Outside the configured indexing scope'; continue; }
            if (!this.registry.mappingComplete || !record?.asset) { item.kind = 'conflict'; item.reason = 'Missing attachment or incomplete index inventory'; continue; }
            if (record.conflict && (record.indexPaths?.length !== 1 || !/Invalid|missing|usage/.test(record.reason))) { item.kind = 'conflict'; item.reason = record.reason; continue; }
            if (!record.index) { item.kind = 'create'; continue; }
            item.file = record.index;
            const text = await this.app.vault.read(record.index), m = readDocument(text).metadata;
            item.hash = fingerprint(text);
            if (m.al_schema === 2) {
                const defaults: Record<string, unknown> = { attachment: '[[' + path + ']]', _filePath: path, _fileType: record.asset.extension.toLowerCase(), url: '', al_usageCount: this.references.getUsage(record).count, al_usageState: this.references.getUsage(record).state };
                for (const key of Object.keys(MANAGED_TYPES)) if (!(key in m) && key in defaults) item.changes[key] = defaults[key];
                const remaining = managedIssues({ ...m, ...item.changes });
                if (remaining.length) { item.kind = 'conflict'; item.reason = remaining.join('; ') + '. Review required values in Properties; keep is never reset automatically.'; continue; }
                if (Object.keys(item.changes).length) item.kind = 'repair';
            }
        }
        return items;
    }
    async apply(items: UpdateItem[]): Promise<string[]> {
        const results: string[] = [];
        for (const item of items) {
            if (!this.isActive()) break;
            try {
                if (!['create', 'repair', 'unchanged'].includes(item.kind)) { results.push('Skipped: ' + item.assetPath + ' — ' + item.reason); continue; }
                await this.registry.refresh();
                if (item.kind === 'create') {
                    const file = this.app.vault.getFileByPath(item.assetPath);
                    if (!file) throw new Error('Attachment disappeared');
                    await this.sidecars.createSidecar(file);
                } else if (item.kind === 'repair') {
                    const file = this.app.vault.getFileByPath(item.indexPath!);
                    if (file !== item.file || !file) throw new Error('Index identity changed');
                    await assertSaved(this.app, file, this.blocked);
                    const text = await this.app.vault.read(file);
                    if (fingerprint(text) !== item.hash) throw new Error('Index changed; preview again');
                    await this.store.save('repair-index', [{ path: file.path, content: text }], item.changes);
                    await this.app.vault.process(file, current => {
                        if (!this.isActive() || fingerprint(current) !== item.hash || this.blocked(file.path)) throw new Error('Index changed or protected');
                        const document = readDocument(current);
                        return '---\n' + stringifyYaml({ ...document.metadata, ...item.changes }) + '---\n' + document.body;
                    });
                    this.registry.invalidate(file.path); this.references.schedule(file.path);
                }
                results.push(item.kind + ': ' + item.assetPath);
            } catch (error) { results.push('Failed: ' + item.assetPath + ' — ' + (error instanceof Error ? error.message : 'Operation failed')); }
        }
        await this.registry.refresh(); await this.references.flushDirty();
        for (const item of items) { const record = this.registry.records.get(item.assetPath); if (record && ['create', 'repair', 'unchanged'].includes(item.kind)) { this.sidecars.authorize(record.indexPath ?? ''); await this.sidecars.writeDerived(record); } }
        await this.store.save('update-attachments', [], results);
        return results;
    }
}
