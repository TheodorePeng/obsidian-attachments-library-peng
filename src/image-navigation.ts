import { effectiveUrl, isSafeUrl } from './managed-properties';
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
export const safeSource = isSafeUrl;
interface ImageControl {
    host: HTMLElement;
    anchor: HTMLAnchorElement;
    frame?: HTMLElement;
    layer?: HTMLElement;
    root: HTMLElement;
    sourcePath: string;
    assetPath: string;
    hoverParent: { hoverPopover: import('obsidian').HoverPopover | null };
    hovered: boolean;
    hoverPoint?: { left: number; top: number };
    session: string;
    timer?: number;
    cleanup: (() => void)[];
}
export class ImageNavigation {
    private controls = new Map<HTMLElement, ImageControl>();
    private roots = new Map<HTMLElement, { source: () => string; view?: EditorView; cleanup: () => void }>();
    private documents = new Map<Document, () => void>();
    private layers = new Map<HTMLElement, HTMLElement>();
    private disposed = false;
    constructor(private app: App, private settings: AttachmentsLibrarySettings, private registry: AttachmentRegistry, private sidecars: SidecarManager) {}

    refresh(): void {
        for (const [root, context] of this.roots) this.decorate(root, context.source(), undefined, context.view);
    }
    editorExtension(): ViewPlugin<{ update: (update: ViewUpdate) => void; destroy: () => void }> {
        return ViewPlugin.define(view => {
            const source = () => view.state.field(editorInfoField, false)?.file?.path ?? '';
            const cleanup = this.observe(view.dom, source, undefined, view);
            return {
                update: update => {
                    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.decorate(view.dom, source(), undefined, view);
                },
                destroy: cleanup,
            };
        });
    }
    observe(root: HTMLElement, source: () => string, _hoverParent?: unknown, view?: EditorView): () => void {
        const decorate = () => this.decorate(root, source(), undefined, view);
        const observer = new MutationObserver(decorate);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });
        const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.measure(root, view));
        resize?.observe(root);
        const scroll = () => this.measure(root, view, true);
        view?.scrollDOM.addEventListener('scroll', scroll, { passive: true });
        root.addEventListener('load', scroll, true);
        root.ownerDocument.defaultView?.addEventListener('resize', scroll);
        const cleanup = () => {
            observer.disconnect(); resize?.disconnect();
            view?.scrollDOM.removeEventListener('scroll', scroll);
            root.removeEventListener('load', scroll, true);
            root.ownerDocument.defaultView?.removeEventListener('resize', scroll);
            this.roots.delete(root);
            for (const control of [...this.controls.values()]) if (control.root === root) this.remove(control);
            this.layers.get(root)?.remove(); this.layers.delete(root);
        };
        this.roots.set(root, { source, view, cleanup });
        decorate();
        return cleanup;
    }
    private bindDocument(doc: Document): void {
        if (this.documents.has(doc)) return;
        const key = (event: KeyboardEvent) => {
            if (event.key !== 'Meta' && event.key !== 'Control') return;
            for (const control of this.controls.values()) {
                if (control.anchor.ownerDocument !== doc || !control.hovered) continue;
                if (event.type === 'keyup') { control.session = ''; continue; }
                const rect = control.anchor.getBoundingClientRect();
                const mouse = new doc.defaultView!.MouseEvent('mouseover', { metaKey: event.metaKey, ctrlKey: event.ctrlKey, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 });
                this.hover(control, mouse);
            }
        };
        const move = (event: MouseEvent) => {
            for (const control of this.controls.values()) {
                if (control.anchor.ownerDocument !== doc) continue;
                const target = event.target as Node | null;
                const popover = control.hoverParent.hoverPopover?.hoverEl;
                if (target && (control.host.contains(target) || control.anchor.contains(target) || popover?.contains(target))) this.show(control);
                else this.hideLater(control);
            }
        };
        doc.addEventListener('keydown', key); doc.addEventListener('keyup', key); doc.addEventListener('mousemove', move);
        this.documents.set(doc, () => { doc.removeEventListener('keydown', key); doc.removeEventListener('keyup', key); doc.removeEventListener('mousemove', move); });
    }
    private show(control: ImageControl): void {
        control.anchor.ownerDocument.defaultView!.clearTimeout(control.timer);
        control.timer = undefined; control.anchor.addClass('alp-image-visible');
    }
    private hideLater(control: ImageControl): void {
        if (control.timer !== undefined || !this.settings.imageButtonAutoHide) return;
        control.timer = control.anchor.ownerDocument.defaultView!.setTimeout(() => {
            control.timer = undefined;
            const doc = control.anchor.ownerDocument;
            const popover = control.hoverParent.hoverPopover?.hoverEl;
            if (control.hovered || control.anchor.contains(doc.activeElement) || (popover && (popover.matches(':hover') || popover.contains(doc.activeElement)))) return;
            control.anchor.removeClass('alp-image-visible');
        }, 200);
    }
    private hover(control: ImageControl, event: MouseEvent): void {
        this.show(control);
        const record = this.registry.records.get(control.assetPath);
        if (!record?.indexPath || record.conflict) return;
        const session = record.indexPath + ':' + (event.metaKey || event.ctrlKey);
        if (control.session === session) return;
        control.session = session;
        this.app.workspace.trigger('hover-link', { event, source: HOVER_SOURCE, hoverParent: control.hoverParent, targetEl: control.anchor, linktext: record.indexPath, sourcePath: control.sourcePath });
    }
    decorate(root: HTMLElement, sourcePath: string, _hoverParent?: unknown, view?: EditorView): void {
        if (this.disposed) return;
        for (const host of root.querySelectorAll<HTMLElement>('.internal-embed')) {
            if (view && host.parentElement?.closest('.markdown-embed')) continue;
            const raw = (host.getAttribute('src') ?? host.getAttribute('data-src') ?? '').split('|')[0].split('#')[0];
            const asset = raw && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw) ? this.app.metadataCache.getFirstLinkpathDest(raw, sourcePath) : null;
            let control = this.controls.get(host);
            if (view && control?.frame) { this.remove(control); control = undefined; }
            // Only direct image embeds, never a Markdown embed containing images.
            if (!host.querySelector('img') || !asset || classifyMedia(asset.path) !== 'image') {
                if (control) this.remove(control);
                continue;
            }
            if (!control) {
                const doc = host.ownerDocument;
                let frame: HTMLElement | undefined, layer: HTMLElement | undefined;
                if (view) {
                    layer = this.layers.get(root);
                    if (!layer) { layer = doc.body.createDiv({ cls: 'alp-editor-overlay' }); this.layers.set(root, layer); }
                } else {
                    frame = doc.createElement('span'); frame.className = 'alp-image-frame';
                    host.replaceWith(frame); frame.appendChild(host);
                }
                const anchor = (layer ?? frame!).createEl('a', { cls: 'alp-image-link', attr: { 'aria-label': '查看附件索引', 'title': '查看索引；command 点击打开出处' } });
                anchor.createSpan({ text: '↗', cls: 'alp-image-glyph' });
                control = { host, anchor, frame, layer, root, sourcePath, assetPath: asset.path, hoverParent: { hoverPopover: null }, hovered: false, session: '', cleanup: [] };
                this.controls.set(host, control);
                this.bindDocument(doc);
                const current = control;
                const listen = (el: EventTarget, type: string, callback: EventListener) => { el.addEventListener(type, callback); current.cleanup.push(() => el.removeEventListener(type, callback)); };
                const perform = (event: MouseEvent) => {
                    const action = routeImageAction(event.button, event.metaKey || event.ctrlKey, this.settings.imageClickMode);
                    const record = this.registry.records.get(current.assetPath);
                    // Native-style Command click opens the index in a tab; hover has no native link recognizer.
                    event.preventDefault(); event.stopPropagation();
                    if (action === 'menu') this.menu(event, record, current.assetPath);
                    else if (action === 'source') this.openSource(record);
                    else void this.openIndex(current.assetPath, action === 'index-tab' || action === 'native');
                };
                listen(anchor, 'mousedown', event => event.stopPropagation());
                listen(anchor, 'pointerdown', event => event.stopPropagation());
                listen(anchor, 'click', event => perform(event as MouseEvent));
                listen(anchor, 'auxclick', event => { if ((event as MouseEvent).button === 1) perform(event as MouseEvent); });
                listen(anchor, 'contextmenu', event => { event.preventDefault(); event.stopPropagation(); this.menu(event as MouseEvent, this.registry.records.get(current.assetPath), current.assetPath); });
                listen(anchor, 'mouseover', event => { if (!current.hovered) { const rect = anchor.getBoundingClientRect(); current.hoverPoint = { left: rect.left, top: rect.top }; } current.hovered = true; this.hover(current, event as MouseEvent); });
                // Let native hover tracking observe this non-embed target and cancel an older image request.
                listen(anchor, 'mouseleave', () => { current.hovered = false; current.hoverPoint = undefined; current.session = ''; this.hideLater(current); this.measure(current.root, this.roots.get(current.root)?.view); });
                listen(anchor, 'focus', () => this.show(current));
                listen(anchor, 'blur', () => this.hideLater(current));
                listen(host, 'mouseenter', () => this.show(current));
                listen(host, 'mouseleave', () => this.hideLater(current));
            }
            control.assetPath = asset.path; control.sourcePath = sourcePath;
            const record = this.registry.records.get(asset.path);
            control.anchor.href = record?.indexPath ?? '#';
            control.anchor.dataset.href = record?.indexPath ?? '';
            control.anchor.dataset.alpAsset = asset.path; control.anchor.dataset.alpSource = sourcePath;
            control.anchor.classList.toggle('alp-image-always', !this.settings.imageButtonAutoHide);
            control.anchor.setAttribute('aria-label', record?.indexPath ? '查看附件索引 ' + record.indexPath : '为附件建立索引 ' + asset.path);
        }
        for (const control of [...this.controls.values()]) if (control.root === root && !root.contains(control.host)) this.remove(control);
        this.measure(root, view);
    }
    private measure(root: HTMLElement, view?: EditorView, force = false): void {
        if (!view || this.disposed) return;
        view.requestMeasure({
            key: this,
            read: () => {
                const viewport = view.scrollDOM.getBoundingClientRect();
                return [...this.controls.values()].filter(c => c.root === root).map(control => {
                    const image = control.host.querySelector('img')!.getBoundingClientRect();
                    const pinned = !force && control.hovered ? control.hoverPoint : undefined;
                    const absoluteLeft = pinned?.left ?? image.right - 26;
                    const absoluteTop = pinned?.top ?? image.top + image.height / 2 - 12;
                    return { control, absoluteLeft, absoluteTop, left: absoluteLeft, top: absoluteTop, visible: image.width > 0 && image.height > 0 && absoluteTop >= viewport.top && absoluteTop + 24 <= viewport.bottom };
                });
            },
            write: positions => {
                if (this.disposed) return;
                for (const { control, absoluteLeft, absoluteTop, left, top, visible } of positions) {
                    // Focus-driven toolbars may collapse when a hover editor opens. Keep
                    // its trigger under the pointer until exit; explicit scroll/resize follows geometry.
                    if (force && control.hovered) control.hoverPoint = { left: absoluteLeft, top: absoluteTop };
                    control.anchor.style.left = left + 'px'; control.anchor.style.top = top + 'px'; control.anchor.style.display = visible ? '' : 'none';
                }
            },
        });
    }
    private remove(control: ImageControl): void {
        control.cleanup.forEach(cleanup => cleanup());
        control.anchor.ownerDocument.defaultView!.clearTimeout(control.timer);
        control.anchor.remove();
        if (control.layer && !control.layer.childElementCount) { control.layer.remove(); this.layers.delete(control.root); }
        if (control.frame?.contains(control.host)) control.frame.replaceWith(control.host);
        else control.frame?.remove();
        this.controls.delete(control.host);
    }
    async openIndex(path: string, newTab = false): Promise<void> {
        let record = this.registry.records.get(path);
        if (record?.conflict) { new Notice('附件关联冲突，请在附件管理中检查。'); return; }
        if (!record?.index) {
            const asset = this.app.vault.getFileByPath(path);
            if (!asset || !await confirmAction(this.app, '建立附件索引？', [path, '只为该附件建立索引，不执行全库补建。'], '建立索引')) return;
            await this.sidecars.createSidecar(asset); this.refresh(); record = this.registry.records.get(path);
        }
        if (!this.disposed && record?.index) await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(record.index);
    }
    openSource(record?: AttachmentRecord): void {
        if (record?.conflict) { new Notice('附件关联冲突。'); return; }
        if (!safeSource(record ? effectiveUrl(record.metadata) : undefined)) { new Notice('索引中未设置有效出处 URL。'); return; }
        window.open(effectiveUrl(record!.metadata).trim(), '_blank');
    }
    private menu(event: MouseEvent, record: AttachmentRecord | undefined, path: string): void {
        new Menu().addItem(item => item.setTitle('打开索引').onClick(() => { void this.openIndex(path); })).addItem(item => item.setTitle('新标签打开索引').onClick(() => { void this.openIndex(path, true); })).addItem(item => item.setTitle('打开出处').onClick(() => this.openSource(record))).showAtMouseEvent(event);
    }
    dispose(): void {
        this.disposed = true;
        for (const context of [...this.roots.values()]) context.cleanup();
        for (const control of [...this.controls.values()]) this.remove(control);
        for (const cleanup of this.documents.values()) cleanup(); this.documents.clear();
    }
}
