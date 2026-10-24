import { App, editorInfoField, Menu, Notice } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { AttachmentRegistry, AttachmentRecord } from './registry';
import { SidecarManager } from './sidecar-manager';
import { AttachmentsLibrarySettings } from './types';
import { classifyMedia } from './file-policy';
import { confirmAction } from './dialogs';
export const HOVER_SOURCE = 'attachments-library-peng';
export function routeImageAction(button: number, modifier: boolean, mode: AttachmentsLibrarySettings['imageClickMode']): 'index' | 'source' | 'index-tab' | 'menu' | 'native' {
    if (button === 2)
        return 'menu';
    if (button === 1)
        return 'index-tab';
    if (modifier)
        return mode === 'nativeCmdClick' ? 'native' : 'source';
    return 'index';
}
export function safeSource(value: unknown): value is string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9+.-]*:/i.test(value.trim()))
        return false;
    try {
        const url = new URL(value.trim());
        return !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'filesystem:', 'chrome:', 'devtools:', 'app:', 'resource:'].includes(url.protocol.toLowerCase());
    }
    catch {
        return false;
    }
}
export class ImageNavigation {
    private controls = new Map<HTMLElement, HTMLAnchorElement>();
    private controlRoots = new WeakMap<HTMLElement, HTMLElement>();
    private observers = new Set<MutationObserver>();
    private disposed = false;
    private roots = new Map<HTMLElement, {
        source: () => string;
        hoverParent: unknown;
    }>();
    refresh(): void { for (const [root, context] of this.roots)
        this.decorate(root, context.source(), context.hoverParent); }
    constructor(private app: App, private settings: AttachmentsLibrarySettings, private registry: AttachmentRegistry, private sidecars: SidecarManager) { }
    editorExtension(): ViewPlugin<{
        update: (update: ViewUpdate) => void;
        destroy: () => void;
    }> {
        return ViewPlugin.define((view: EditorView) => {
            const source = () => view.state.field(editorInfoField, false)?.file?.path ?? '';
            const cleanup = this.observe(view.dom, source, { hoverPopover: null });
            return { update: (update: ViewUpdate) => { if (update.docChanged || update.viewportChanged)
                    this.decorate(view.dom, source(), { hoverPopover: null }); }, destroy: cleanup };
        });
    }
    observe(root: HTMLElement, source: () => string, hoverParent: unknown): () => void {
        this.roots.set(root, { source, hoverParent });
        const decorate = () => this.decorate(root, source(), hoverParent);
        decorate();
        const observer = new MutationObserver(decorate);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });
        this.observers.add(observer);
        return () => { this.roots.delete(root); observer.disconnect(); this.observers.delete(observer); for (const [host, anchor] of this.controls)
            if (root.contains(host) || this.controlRoots.get(host) === root) {
                anchor.remove();
                host.removeClass('alp-image-host');
                this.controls.delete(host);
            } };
    }
    decorate(root: HTMLElement, sourcePath: string, hoverParent?: unknown): void {
        if (this.disposed)
            return;
        for (const host of root.querySelectorAll<HTMLElement>('.internal-embed')) {
            const remove = () => { this.controls.get(host)?.remove(); this.controls.delete(host); host.removeClass('alp-image-host'); };
            if (!host.querySelector('img')) {
                remove();
                continue;
            }
            const raw = (host.getAttribute('src') ?? host.getAttribute('data-src') ?? '').split('|')[0].split('#')[0];
            if (!raw || /^[a-z][\w+.-]*:/i.test(raw)) {
                remove();
                continue;
            }
            const asset = this.app.metadataCache.getFirstLinkpathDest(raw, sourcePath);
            if (!asset || classifyMedia(asset.path) !== 'image') {
                remove();
                continue;
            }
            let anchor = this.controls.get(host);
            if (!anchor) {
                anchor = host.createEl('a', { text: '↗', cls: 'alp-image-link internal-link', attr: { 'aria-label': 'Open attachment metadata', 'title': 'Metadata · cmd/ctrl-click source · middle-click new tab' } });
                host.addClass('alp-image-host');
                this.controls.set(host, anchor);
                this.controlRoots.set(host, root);
                const control = anchor;
                const record = () => this.registry.records.get(control.dataset.alpAsset ?? '');
                const perform = (event: MouseEvent) => {
                    const action = routeImageAction(event.button, event.metaKey || event.ctrlKey, this.settings.imageClickMode);
                    if (action === 'native' && record()?.index && !record()?.conflict)
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (action === 'menu') {
                        this.menu(event, record(), control.dataset.alpAsset ?? '');
                        return;
                    }
                    if (action === 'source') {
                        this.openSource(record());
                        return;
                    }
                    void this.openIndex(control.dataset.alpAsset ?? '', action === 'index-tab' || action === 'native');
                };
                anchor.addEventListener('click', perform);
                anchor.addEventListener('auxclick', event => { if (event.button === 1)
                    perform(event); });
                anchor.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); this.menu(event, record(), control.dataset.alpAsset ?? ''); });
                anchor.addEventListener('mouseover', event => { const current = record(); if (current?.indexPath && !current.conflict)
                    this.app.workspace.trigger('hover-link', { event, source: HOVER_SOURCE, hoverParent, targetEl: control, linktext: current.indexPath, sourcePath: control.dataset.alpSource ?? '' }); });
            }
            anchor.dataset.alpAsset = asset.path;
            anchor.dataset.alpSource = sourcePath;
            const record = this.registry.records.get(asset.path);
            anchor.href = record?.indexPath ?? '#';
            anchor.dataset.href = record?.indexPath ?? '';
            anchor.setAttribute('aria-label', record?.indexPath ? 'Open metadata ' + record.indexPath : 'Create metadata for ' + asset.path);
        }
        for (const [host, anchor] of this.controls)
            // Obsidian renders Markdown in detached containers before mounting.
            // Removing a newly added control there causes an observer add/remove
            // loop that prevents the render promise from ever completing.
            if (this.controlRoots.get(host) === root && !root.contains(host)) {
                anchor.remove();
                host.removeClass('alp-image-host');
                this.controls.delete(host);
            }
    }
    async openIndex(path: string, newTab = false): Promise<void> {
        let record = this.registry.records.get(path);
        if (record?.conflict) {
            new Notice('Attachment association conflict. Review the library before opening.');
            return;
        }
        if (!record?.index) {
            const asset = this.app.vault.getFileByPath(path);
            if (!asset || !await confirmAction(this.app, 'Create attachment metadata?', [path, 'Only this attachment will receive an index document.'], 'Create metadata'))
                return;
            await this.sidecars.createSidecar(asset);
            this.refresh();
            record = this.registry.records.get(path);
        }
        if (record?.index)
            await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(record.index);
    }
    openSource(record?: AttachmentRecord): void {
        if (record?.conflict) {
            new Notice('Attachment association conflict.');
            return;
        }
        if (!safeSource(record?.metadata.source)) {
            new Notice('No valid source URL in the metadata document.');
            return;
        }
        window.open(record.metadata.source.trim(), '_blank');
    }
    private menu(event: MouseEvent, record: AttachmentRecord | undefined, path: string): void {
        new Menu().addItem(item => item.setTitle('Open metadata').onClick(() => { void this.openIndex(path); })).addItem(item => item.setTitle('Open metadata in new tab').onClick(() => { void this.openIndex(path, true); })).addItem(item => item.setTitle('Open source URL').onClick(() => this.openSource(record))).showAtMouseEvent(event);
    }
    dispose(): void { this.disposed = true; for (const observer of this.observers)
        observer.disconnect(); this.observers.clear(); this.roots.clear(); for (const [host, anchor] of this.controls) {
        anchor.remove();
        host.removeClass('alp-image-host');
    } this.controls.clear(); }
}
