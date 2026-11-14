/* eslint-disable obsidianmd/ui/sentence-case -- Base, Vault and OCR are product/API nouns. */
import { App, Notice, PluginSettingTab, Setting, Menu } from 'obsidian';
import type AttachmentsLibraryPlugin from './main';
import { normalizeExtensions } from './file-policy';
import { PathSuggest } from './path-suggest';
import { inputVaultPath } from './paths';
import { GalleryConnection } from './gallery-connection';
import { restoreLibraryDialog, recoveryDialog } from './library-dialogs';
import { galleryViews } from './gallery-destination';
import { MANAGED_TYPES } from './managed-properties';
export class AttachmentsLibrarySettingsTab extends PluginSettingTab {
    constructor(app: App, private plugin: AttachmentsLibraryPlugin) { super(app, plugin); }
    private folderDraft?: string;
    private folderApplied = '';
    private busy = false;
    private showing = false;
    private renderId = 0;
    private suggesters: PathSuggest[] = [];
    private galleryEl?: HTMLElement;
    private folderInput?: HTMLInputElement;
    private folderFeedback?: HTMLElement;
    private disposeSuggestions(): void { this.suggesters.forEach(suggest => suggest.dispose()); this.suggesters = []; }
    hide(): void { this.showing = false; this.renderId++; this.disposeSuggestions(); this.folderDraft = undefined; }
    pathsChanged(): void {
        if (!this.showing) return;
        if (this.galleryEl) this.baseSettings(this.galleryEl);
        const folder = this.plugin.settings.libraryFolder;
        if (this.busy) return;
        if (this.folderDraft === this.folderApplied) { this.folderDraft = folder; if (this.folderInput) { this.folderInput.value = folder; this.folderInput.dispatchEvent(new Event('input')); } }
        else if (folder !== this.folderApplied) this.folderFeedback?.setText('Saved location moved. Your draft is preserved; cancel changes to use ' + folder + '.');
        this.folderApplied = folder;
    }
    private baseSettings(el: HTMLElement): void {
        el.empty(); const s = this.plugin.settings, id = ++this.renderId;
        const card = el.createDiv({ cls: 'alp-gallery-card' });
        const status = card.createEl('p', { text: s.defaultBasePath ? '◌ Checking connection…' : 'No gallery connected', cls: 'alp-gallery-status', attr: { 'aria-live': 'polite' } });
        const action = (label: string, handler: () => void, primary = false) => { const button = actions.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' }); button.addEventListener('click', handler); return button; };
        if (!s.defaultBasePath) {
            card.createEl('p', { text: 'Use an existing Base or create a new one. Existing files will be preserved.' });
            const actions = card.createDiv({ cls: 'alp-card-actions' });
            const connect = actions.createEl('button', { text: 'Connect gallery…', cls: 'mod-cta' }); connect.addEventListener('click', () => new GalleryConnection(this.app, this.plugin, () => this.pathsChanged(), connect).open()); return;
        }
        card.createEl('p', { text: 'Base', cls: 'alp-field-label' }); card.createEl('p', { text: s.defaultBasePath, cls: 'alp-path' });
        card.createEl('p', { text: 'Default view', cls: 'alp-field-label' }); card.createEl('p', { text: s.defaultViewName || 'Not selected' });
        card.createEl('p', { text: 'Base filters control which indexes are shown. A connected gallery may have no matching rows.', cls: 'alp-helper' });
        const actions = card.createDiv({ cls: 'alp-card-actions' });
        const open = action('Open gallery', () => { void this.action(() => this.plugin.openLibrary()); }, true);
        const change = action('Change…', () => new GalleryConnection(this.app, this.plugin, () => this.pathsChanged(), change).open());
        const more = action('More…', () => {
            const menu = new Menu(); menu.addItem(item => item.setTitle('Disconnect').setIcon('unlink').onClick(() => { void this.action(() => this.plugin.clearBase()); }));
            const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
        });
        void (async () => {
            try {
                const file = this.app.vault.getFileByPath(s.defaultBasePath!); if (!file) throw new Error('Base file missing');
                const views = galleryViews(await this.app.vault.read(file));
                if (!this.showing || id !== this.renderId) return;
                if (!views.length) throw new Error('No compatible gallery view');
                const names = views.filter(view => view.name === s.defaultViewName);
                const fallback = s.defaultViewOwner ? views.filter(view => view.owner === s.defaultViewOwner) : [];
                if (names.length !== 1 && fallback.length !== 1) throw new Error('Default view missing or ambiguous');
                status.setText('✓ Ready');
            } catch (e) { if (this.showing && id === this.renderId) { status.setText('⚠ ' + (e instanceof Error ? e.message : 'Invalid Base')); open.disabled = true; change.setText('Fix connection…'); } }
        })();
    }
    private folderSettings(el: HTMLElement): void {
        const area = el.createDiv({ cls: 'alp-folder-settings' });
        area.createEl('label', { text: 'New index notes folder', cls: 'alp-field-label', attr: { for: 'alp-index-folder' } });
        area.createEl('p', { text: 'Where new Markdown index notes are created. Existing indexes stay where they are.', cls: 'alp-helper' });
        const input = area.createEl('input', { cls: 'alp-path-input', attr: { id: 'alp-index-folder', type: 'text', 'aria-describedby': 'alp-folder-example alp-folder-feedback' } }); this.folderInput = input;
        input.value = this.folderDraft ?? '';
        const example = area.createEl('p', { cls: 'alp-helper alp-path', attr: { id: 'alp-folder-example' } });
        const feedback = area.createEl('p', { cls: 'alp-field-feedback', attr: { id: 'alp-folder-feedback', 'aria-live': 'polite' } }); this.folderFeedback = feedback;
        const actions = area.createDiv({ cls: 'alp-card-actions' });
        const cancel = actions.createEl('button', { text: 'Cancel changes' });
        const save = actions.createEl('button', { text: 'Save location', cls: 'mod-cta' });
        let composing = false; input.addEventListener('compositionstart', () => { composing = true; }); input.addEventListener('compositionend', () => { composing = false; });
        const update = () => {
            this.folderDraft = input.value; input.removeAttribute('aria-invalid'); feedback.removeAttribute('role'); feedback.setText('');
            try { example.setText('Example: ' + inputVaultPath(this.app, input.value) + '/image.png.md'); } catch { example.setText('Enter a folder inside this Vault.'); }
            save.disabled = this.busy || input.value === this.plugin.settings.libraryFolder; cancel.disabled = this.busy || save.disabled;
        };
        input.addEventListener('input', update);
        this.suggesters.push(new PathSuggest(this.app, input, 'folder', value => { input.value = value; update(); }));
        cancel.addEventListener('click', () => { input.value = this.plugin.settings.libraryFolder; this.folderApplied = input.value; update(); input.focus(); });
        save.addEventListener('click', () => { void (async () => {
            if (this.busy || composing || save.disabled) return;
            this.busy = true; save.disabled = cancel.disabled = input.disabled = true; feedback.setText('Saving location…');
            const draft = input.value;
            try { await this.plugin.setIndexFolder(draft); this.folderApplied = this.folderDraft = this.plugin.settings.libraryFolder; input.value = this.folderApplied; feedback.setText('Saved: ' + this.folderApplied); }
            catch(e) { input.setAttribute('aria-invalid','true'); feedback.setAttribute('role','alert'); feedback.setText((e instanceof Error ? e.message : 'Save failed') + ' The previous saved location is still active.'); }
            finally { this.busy = false; input.disabled = false; save.disabled = cancel.disabled = input.value === this.plugin.settings.libraryFolder; input.focus(); }
        })(); });
        update();
    }
    private async action(action: () => Promise<void>): Promise<void> { try { await action(); } catch (error) { new Notice(error instanceof Error ? error.message : 'Operation failed'); } finally { if (this.showing) this.render(); } }
    display(): void { this.render(); }
    private render(): void {
        this.disposeSuggestions(); this.showing = true; this.renderId++;
        const el = this.containerEl; el.empty(); el.addClass('alp-settings'); const s = this.plugin.settings;
        this.folderApplied = s.libraryFolder; this.folderDraft ??= this.folderApplied;
        new Setting(el).setName('Gallery').setHeading();
        this.galleryEl = el.createDiv(); this.baseSettings(this.galleryEl);
        new Setting(el).setName('Indexing').setHeading();
        new Setting(el).setName('Index scope').setDesc('Attachment scope is independent of base filters. Reference safety always covers the whole vault.').addDropdown(d => d.addOptions({ vault: 'Entire Vault', folder: 'Attachment folder' }).setValue(s.indexScope).onChange(async v => { s.indexScope = v === 'folder' ? 'folder' : 'vault'; await this.action(() => this.plugin.saveSettings()); }));
        if (s.indexScope === 'folder') new Setting(el).setName('Attachment folder').addText(t => t.setValue(s.attachmentsFolder).onChange(async v => { s.attachmentsFolder = v.trim().replace(/^\/+|\/+$/g, '') || 'Attachments'; await this.plugin.saveSettings(); }));
        this.folderSettings(el);
        new Setting(el).setName('Extensions').setDesc('Attachment whitelist. Markdown, bases, canvas, hidden folders and index notes are always excluded.').addText(t => t.setValue(s.watchedExtensions.join(', ')).onChange(async v => { s.watchedExtensions = normalizeExtensions(v.split(',')); await this.plugin.saveSettings(); }));
        new Setting(el).setName('Create indexes for new attachments').setDesc('Only future attachments. Enabling this does not scan existing files or require a full scan.').addToggle(t => t.setValue(s.autoCreateOnNew).onChange(async v => { await this.action(() => this.plugin.setAutoCreate(v)); }));
        new Setting(el).setName('Existing library').setHeading();
        new Setting(el).setName('Restore existing library').setDesc('Discover compatible Bases and portable indexes. Explicitly adopt legacy indexes without moving or migrating them.').addButton(b => b.setButtonText('Restore existing library…').onClick(() => restoreLibraryDialog(this.app, this.plugin)));
        new Setting(el).setName('Image interaction').setHeading();
        new Setting(el).setName('Auto-hide image button').setDesc('Show the right-edge index button on hover or focus.').addToggle(t => t.setValue(s.imageButtonAutoHide).onChange(async v => { s.imageButtonAutoHide = v; await this.plugin.saveSettings(); this.plugin.images.refresh(); }));
        new Setting(el).setName('Command/ctrl-click').addDropdown(d => d.addOptions({ index: 'Open URL', nativeCmdClick: 'Open index in a new tab' }).setValue(s.imageClickMode).onChange(async v => { s.imageClickMode = v === 'nativeCmdClick' ? 'nativeCmdClick' : 'index'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Maintenance & recovery').setHeading();
        new Setting(el).setName('Required properties').setDesc(Object.entries(MANAGED_TYPES).map(([key, type]) => key + ': ' + type).join(' · ') + '. User properties such as source and tags are not managed.');
        const check = this.plugin.propertyTypes?.check();
        new Setting(el).setName('Property types').setDesc(!check?.available ? 'Native registration unavailable or still preparing. Use Obsidian Properties to set types when unavailable.' : check.conflicts.length ? check.conflicts.map(c => c.key + ': expected ' + c.expected + (c.assigned ? ', assigned ' + c.assigned : '') + '; ' + c.paths.join(', ')).join('\n') : check.missing.length ? 'Unregistered: ' + check.missing.join(', ') : 'All required types are registered.').addButton(b => b.setButtonText('Check types').onClick(() => { void this.action(() => this.plugin.checkPropertyTypes()); })).addButton(b => b.setButtonText('Register compatible types').onClick(() => { void this.action(() => this.plugin.checkPropertyTypes(true)); }));
        new Setting(el).setName('Deletion recovery').setDesc('Review completed and interrupted operations. Restore only when original paths and subsequent edits are safe.').addButton(b => b.setButtonText('Recovery records…').onClick(() => recoveryDialog(this.app, this.plugin)));

        new Setting(el).setName('Scan attachments').setDesc('Choose the configured scope or one folder. Preview new indexes and required-property repairs.').addButton(b => b.setButtonText('Scan…').onClick(() => { void this.action(() => this.plugin.runBackfill()); }));
        new Setting(el).setName('Migrate index properties').setDesc('Preview legacy fields, conflicts and base dependencies. Back up before applying. No startup migration.').addButton(b => b.setButtonText('Migrate…').onClick(() => { void this.action(() => this.plugin.migrateProperties()); }));
        new Setting(el).setName('Repair gallery views').setDesc('Preview repairs to plugin-owned views in the default base.').addButton(b => b.setButtonText('Preview…').onClick(() => { void this.action(() => this.plugin.reviewLibraryConfiguration()); }));
        new Setting(el).setName('Rebuild reference index').setDesc('Read all reference sources. Routine updates use the incremental cache.').addButton(b => b.setButtonText('Rebuild').onClick(() => { void this.action(() => this.plugin.rebuildReferences()); }));
        new Setting(el).setName('Recent operation report').setDesc(this.plugin.recentReport + (this.plugin.store.lastReport ? '\nRecovery: ' + this.plugin.store.lastReport : ''));
        new Setting(el).setName('Command shortcuts').setDesc('Three commands: Open attachment gallery; Update current attachment…; Scan attachments…. If you used refresh references or review library configuration, rebind its shortcut manually.');
    }
}
