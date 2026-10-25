import { App, HoverParent } from 'obsidian';
export const GALLERY_HOVER_SOURCE = 'attachments-library-peng-gallery';
/** Own links use exactly one hover source; neutral bubbling clears stale native candidates. */
export class GalleryIndexLinks {
    private links = new Map<HTMLAnchorElement, { path: string; parent: HoverParent; session: string; cleanup: () => void }>();
    private active?: HTMLAnchorElement;
    private documents = new Map<Document, () => void>();
    constructor(private app: App) {}
    bind(anchor: HTMLAnchorElement, path: string): void {
        if (this.links.has(anchor)) return;
        anchor.href = path;
        anchor.dataset.href = path;
        const info = { path, parent: { hoverPopover: null } as HoverParent, session: '', cleanup: () => {} };
        const enter = (event: MouseEvent) => { this.active = anchor; this.hover(anchor, event); };
        const leave = () => { info.session = ''; if (this.active === anchor) this.active = undefined; };
        anchor.addEventListener('mouseover', enter); anchor.addEventListener('mouseleave', leave);
        info.cleanup = () => { anchor.removeEventListener('mouseover', enter); anchor.removeEventListener('mouseleave', leave); leave(); };
        this.links.set(anchor, info);
        const doc = anchor.ownerDocument;
        if (!this.documents.has(doc)) {
            const key = (event: KeyboardEvent) => {
                if (event.key !== 'Meta' && event.key !== 'Control') return;
                const active = this.active; if (!active || active.ownerDocument !== doc) return;
                if (event.type === 'keyup') { this.links.get(active)!.session = ''; return; }
                const rect = active.getBoundingClientRect();
                this.hover(active, new doc.defaultView!.MouseEvent('mouseover', { metaKey: event.metaKey, ctrlKey: event.ctrlKey, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
            };
            doc.addEventListener('keydown', key); doc.addEventListener('keyup', key);
            this.documents.set(doc, () => { doc.removeEventListener('keydown', key); doc.removeEventListener('keyup', key); });
        }
    }
    private hover(anchor: HTMLAnchorElement, event: MouseEvent): void {
        const info = this.links.get(anchor); if (!info) return;
        const session = String(event.metaKey || event.ctrlKey);
        if (info.session === session) return;
        info.session = session;
        this.app.workspace.trigger('hover-link', { event, source: GALLERY_HOVER_SOURCE, hoverParent: info.parent, targetEl: anchor, linktext: info.path, sourcePath: info.path });
    }
    unbind(anchor: HTMLAnchorElement): void { this.links.get(anchor)?.cleanup(); this.links.delete(anchor); }
    dispose(): void { for (const info of this.links.values()) info.cleanup(); this.links.clear(); for (const cleanup of this.documents.values()) cleanup(); this.documents.clear(); }
}
