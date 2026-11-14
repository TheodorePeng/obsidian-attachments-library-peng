/* eslint-disable obsidianmd/ui/sentence-case -- Base, Vault and OCR are product/API nouns. */
import { App, Modal, TFile, Platform } from 'obsidian';
import type AttachmentsLibraryPlugin from './main';
import { baseName, existingBase } from './paths';
import { galleryViews, preferredView } from './gallery-destination';
import { VIEW_TYPE } from './bases-creator';
import { PathSuggest } from './path-suggest';
import { yamlSource } from './yaml-source';
import { confirmAction } from './dialogs';
import { GALLERY_DEFAULT_ORDER } from './gallery-config';
export class GalleryConnection extends Modal {
    private mode: 'existing' | 'new' = 'existing';
    private path: string;
    private name = 'Attachments Library.base';
    private view = '';
    private request = 0;
    private busy = false;
    private closed = false;
    private suggest?: PathSuggest;
    private identity?: TFile;
    private expected = '';
    private origin: HTMLElement | null;
    constructor(app: App, private plugin: AttachmentsLibraryPlugin, private changed: () => void, origin?: HTMLElement) { super(app); this.origin = origin ?? (typeof activeDocument !== 'undefined' ? activeDocument.activeElement as HTMLElement | null : null); this.path = plugin.settings.defaultBasePath ?? ''; }
    close(): void { if (!this.busy) super.close(); }
    onOpen(): void { this.titleEl.setText('Connect gallery'); this.contentEl.addClass('alp-connection'); this.render(); }
    onClose(): void { this.closed = true; this.request++; this.suggest?.dispose(); this.contentEl.empty();
        const doc = this.origin?.ownerDocument ?? this.contentEl.ownerDocument;
        const target = this.origin?.isConnected ? this.origin : [...doc.querySelectorAll<HTMLButtonElement>('.alp-gallery-card button')].find(button => /^(Change|Fix connection|Connect gallery)/.test(button.textContent ?? ''));
        target?.focus(); }
    private render(): void {
        this.suggest?.dispose(); this.request++; const el = this.contentEl; el.empty();
        const modes = el.createDiv({ cls: 'alp-segmented', attr: { role: 'group', 'aria-label': 'Connection method' } });
        for (const [key, label] of [['existing', 'Existing Base'], ['new', 'New Base']] as const) {
            const button = modes.createEl('button', { text: label, attr: { 'aria-pressed': String(this.mode === key) } });
            button.disabled = this.busy; button.addEventListener('click', () => { if (this.busy) return; this.mode = key; this.render(); });
        }
        const label = el.createEl('label', { text: this.mode === 'existing' ? 'Base file' : 'File name', attr: { for: 'alp-connection-path' } });
        label.addClass('alp-field-label');
        const input = el.createEl('input', { cls: 'alp-path-input', attr: { id: 'alp-connection-path', type: 'text', 'aria-describedby': 'alp-connection-feedback', autocomplete: 'off' } });
        input.value = this.mode === 'existing' ? this.path : this.name;
        const viewLabel = el.createEl('label', { text: 'Default view', cls: 'alp-field-label', attr: { for: 'alp-connection-view' } });
        const select = el.createEl('select', { attr: { id: 'alp-connection-view' } });
        const feedback = el.createEl('p', { cls: 'alp-field-feedback', attr: { id: 'alp-connection-feedback', 'aria-live': 'polite' } });
        const add = el.createEl('button', { text: 'Add gallery view…' }); add.hidden = true;
        const footer = el.createDiv({ cls: 'alp-dialog-actions' });
        const cancel = footer.createEl('button', { text: 'Cancel' }); cancel.addEventListener('click', () => this.close());
        const save = footer.createEl('button', { text: this.mode === 'existing' ? 'Save connection' : 'Create and connect', cls: 'mod-cta' });
        const error = (message: string) => { feedback.setText(message); feedback.setAttribute('role', 'alert'); input.setAttribute('aria-invalid', 'true'); };
        const check = async () => {
            const id = ++this.request, path = this.path; this.identity = undefined; save.disabled = true; add.hidden = true;
            feedback.removeAttribute('role'); input.removeAttribute('aria-invalid');
            if (this.mode === 'new') {
                viewLabel.hidden = select.hidden = true;
                try { feedback.setText('Vault root: ' + baseName(this.name) + '. Creates a new file; existing files are preserved.'); save.disabled = this.busy; } catch (e) { error((e as Error).message); }
                return;
            }
            viewLabel.hidden = select.hidden = false; select.empty(); feedback.setText('Checking Base…');
            try {
                const file = existingBase(this.app, path), content = await this.app.vault.read(file), views = galleryViews(content);
                if (id !== this.request || this.closed) return;
                this.identity = file; this.expected = content;
                if (!views.length) { feedback.setText('No compatible gallery view. Add one explicitly; existing filters and views will be preserved.'); add.hidden = false; return; }
                select.createEl('option', { text: 'Choose a gallery view', attr: { value: '' } });
                for (const view of views) { const option = select.createEl('option', { text: view.name, attr: { value: view.name } }); option.disabled = views.filter(item => item.name === view.name).length !== 1; }
                this.view = preferredView(views, file.path, this.plugin.settings); select.value = this.view;
                feedback.setText('✓ Compatible gallery found. Base filters control which indexes are shown.'); save.disabled = !this.view || this.busy;
            } catch (e) { if (id === this.request && !this.closed) error((e as Error).message); }
        };
        select.addEventListener('change', () => { this.view = select.value; save.disabled = !this.view || this.busy; });
        input.addEventListener('input', () => { if (this.mode === 'existing') this.path = input.value; else this.name = input.value; void check(); });
        if (this.mode === 'existing') this.suggest = new PathSuggest(this.app, input, 'base', value => { this.path = value; void check(); });
        add.addEventListener('click', () => { void (async () => {
            if (this.busy || !this.identity) return;
            this.busy = true; add.disabled = true;
            try {
                if (!Platform.isDesktopApp) throw new Error('Adding gallery views requires desktop recovery backups.');
                const file = this.identity, original = this.expected, doc = yamlSource(original);
                const config = doc.toJS() as { views?: { name?: string }[] };
                let name = 'Attachment gallery', i = 2;
                while (config.views?.some(view => view.name === name)) name = 'Attachment gallery ' + i++;
                const view = { type: VIEW_TYPE, name, pageSize: 60, order: [...GALLERY_DEFAULT_ORDER], image: 'note.attachment' };
                if (!doc.has('views')) doc.set('views', []);
                doc.addIn(['views'], view);
                const updated = doc.toString();
                if (!await confirmAction(this.app, 'Add gallery view', [file.path, 'Add: ' + name, 'Existing views, filters and names are preserved.', updated], 'Add view')) return;
                await this.plugin.store.save('add-gallery-view', [{ path: file.path, content: original }], { updated });
                await this.app.vault.process(file, current => { if (current !== original || this.app.vault.getFileByPath(file.path) !== file) throw new Error('Base changed; recheck.'); return updated; });
                await check();
            } catch (e) { error((e as Error).message); }
            finally { this.busy = false; add.disabled = false; save.disabled = !this.view; }
        })(); });
        let composing = false; input.addEventListener('compositionstart', () => { composing = true; }); input.addEventListener('compositionend', () => { composing = false; });
        save.addEventListener('click', () => { void (async () => {
            if (this.busy || composing || save.disabled) return;
            this.busy = true; save.disabled = cancel.disabled = input.disabled = select.disabled = true; feedback.setText('Saving connection…');
            try {
                if (this.mode === 'new') await this.plugin.createGallery(this.name);
                else if (this.identity) await this.plugin.connectGallery(this.path, this.view, this.expected, this.identity);
                else throw new Error('Recheck the Base before saving.');
                this.busy = false; this.changed(); this.close();
            } catch (e) { error((e as Error).message); }
            finally { this.busy = false; save.disabled = false; cancel.disabled = input.disabled = select.disabled = false; if (!this.closed) input.focus(); }
        })(); });
        void check(); input.focus();
    }
}
