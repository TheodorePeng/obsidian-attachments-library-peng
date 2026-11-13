import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AttachmentsLibraryPlugin from './main';
import { normalizeExtensions } from './file-policy';
import { PathSuggest } from './path-suggest';
import { baseName, vaultPath } from './paths';
import { galleryViews } from './gallery-destination';
import { MANAGED_TYPES } from './managed-properties';
export class AttachmentsLibrarySettingsTab extends PluginSettingTab {
    constructor(app: App, private plugin: AttachmentsLibraryPlugin) { super(app, plugin); }
    private mode: 'existing' | 'create' = 'existing';
    private baseDraft?: string;
    private folderDraft?: string;
    private baseApplied = '';
    private folderApplied = '';
    private newName = 'Attachments Library.base';
    private busy = false;
    private error = '';
    private moved = '';
    private showing = false;
    private renderId = 0;
    private suggesters: PathSuggest[] = [];
    private disposeSuggestions(): void { this.suggesters.forEach(suggest => suggest.dispose()); this.suggesters = []; }
    hide(): void {
        this.showing = false; this.renderId++; this.disposeSuggestions();
        this.baseDraft = undefined; this.folderDraft = undefined; this.error = ''; this.moved = ''; this.mode = 'existing'; this.newName = 'Attachments Library.base';
    }
    pathsChanged(): void {
        if (!this.showing) return;
        const base = this.plugin.settings.defaultBasePath ?? '', folder = this.plugin.settings.libraryFolder;
        if (this.baseDraft === this.baseApplied) this.baseDraft = base;
        else if (base !== this.baseApplied) this.moved = 'The selected Base moved. Your unapplied input is preserved.';
        if (this.folderDraft === this.folderApplied) this.folderDraft = folder;
        else if (folder !== this.folderApplied) this.moved = 'The index folder moved. Your unapplied input is preserved.';
        this.render();
    }
    private async pathAction(action: () => Promise<void>, success: () => void): Promise<void> {
        if (this.busy) return;
        this.busy = true; this.error = ''; this.render();
        try { await action(); success(); this.moved = ''; }
        catch (error) { this.error = error instanceof Error ? error.message : 'Operation failed'; }
        finally { this.busy = false; if (this.showing) this.render(); }
    }
    private baseSettings(el: HTMLElement): void {
        const s = this.plugin.settings, bound = !!s.defaultBasePath;
        if (!bound) new Setting(el).setName('Base setup').addDropdown(drop => drop.addOptions({ existing: 'Use existing Base', create: 'Create new Base' }).setValue(this.mode).setDisabled(this.busy).onChange(value => { this.mode = value === 'create' ? 'create' : 'existing'; this.error = ''; this.render(); }));
        if (!bound && this.mode === 'create') {
            const row = new Setting(el).setName('New base file');
            const preview = () => { try { row.setDesc('Vault root: ' + baseName(this.newName)); } catch (error) { row.setDesc(error instanceof Error ? error.message : 'Invalid name'); } };
            row.addText(text => text.setValue(this.newName).setDisabled(this.busy).onChange(value => { this.newName = value; preview(); }))
                .addButton(button => button.setButtonText('Create').setCta().setDisabled(this.busy).onClick(() => { const name = this.newName; void this.pathAction(() => this.plugin.createGallery(name), () => { this.baseDraft = this.plugin.settings.defaultBasePath ?? ''; }); }));
            preview();
        } else {
            const row = new Setting(el).setName('Default base file').setDesc('Vault-relative .base path. This choice controls the open command. Apply to save.');
            row.addText(text => {
                text.setValue(this.baseDraft ?? '').setPlaceholder('Folder/Attachments Library.base').setDisabled(this.busy).onChange(value => { this.baseDraft = value; });
                this.suggesters.push(new PathSuggest(this.app, text.inputEl, 'base', value => { this.baseDraft = value; }));
            }).addButton(button => button.setButtonText('Apply').setDisabled(this.busy).onClick(() => { const path = this.baseDraft ?? ''; void this.pathAction(() => this.plugin.selectBase(path), () => { this.baseDraft = this.plugin.settings.defaultBasePath ?? ''; }); }));
            if (bound) {
                row.addButton(button => button.setButtonText('Open').setDisabled(this.busy).onClick(() => { void this.action(() => this.plugin.openLibrary()); }))
                    .addButton(button => button.setButtonText('Clear selection').setDisabled(this.busy).onClick(() => { void this.pathAction(() => this.plugin.clearBase(), () => { this.baseDraft = ''; this.mode = 'existing'; }); }));
                const status = new Setting(el).setName('Base status').setDesc('Checking selected base…');
                const id = this.renderId, path = s.defaultBasePath!;
                void (async () => {
                    try {
                        const file = this.app.vault.getFileByPath(path);
                        if (!file || file.extension.toLowerCase() !== 'base') throw new Error('Selected Base is missing. Apply another path or clear the selection.');
                        const views = galleryViews(await this.app.vault.cachedRead(file));
                        if (id !== this.renderId || !this.showing || this.plugin.settings.defaultBasePath !== path) return;
                        const matches = views.filter(view => s.defaultViewOwner ? view.owner === s.defaultViewOwner : view.name === s.defaultViewName);
                        status.setDesc(!views.length ? 'No attachment gallery. Use Repair gallery views in Maintenance.' : matches.length !== 1 ? 'Default gallery view is missing or ambiguous. Choose a default view.' : 'Selected: ' + path);
                    } catch (error) { if (id === this.renderId && this.showing) status.setDesc(error instanceof Error ? error.message : 'Invalid Base'); }
                })();
            }
        }
        if (bound) new Setting(el).setName('Default view').setDesc(s.defaultViewName || 'Not selected. Choose a gallery view in the default Base.').addButton(b => b.setButtonText('Choose view…').setDisabled(this.busy).onClick(() => { void this.action(() => this.plugin.selectDefaultView()); }));
        if (this.error || this.moved) new Setting(el).setName('Path status').setDesc([this.error, this.moved].filter(Boolean).join(' '));
    }
    private folderSettings(el: HTMLElement): void {
        const row = new Setting(el).setName('Index notes folder');
        const preview = () => {
            try { row.setDesc('New indexes only; existing notes keep their location. Example: ' + vaultPath(this.folderDraft ?? '') + '/image.png.md. Apply to save.'); }
            catch (error) { row.setDesc(error instanceof Error ? error.message : 'Invalid folder'); }
        };
        row.addText(text => {
            text.setValue(this.folderDraft ?? '').setPlaceholder('Library').setDisabled(this.busy).onChange(value => { this.folderDraft = value; preview(); });
            this.suggesters.push(new PathSuggest(this.app, text.inputEl, 'folder', value => { this.folderDraft = value; preview(); }));
        }).addButton(button => button.setButtonText('Apply').setDisabled(this.busy).onClick(() => { const folder = this.folderDraft ?? ''; void this.pathAction(() => this.plugin.setIndexFolder(folder), () => { this.folderDraft = this.plugin.settings.libraryFolder; }); }));
        preview();
    }
    private async action(action: () => Promise<void>): Promise<void> { try { await action(); } catch (error) { new Notice(error instanceof Error ? error.message : 'Operation failed'); } finally { if (this.showing) this.render(); } }
    display(): void { this.render(); }
    private render(): void {
        this.disposeSuggestions(); this.showing = true; this.renderId++;
        const el = this.containerEl; el.empty(); const s = this.plugin.settings;
        this.baseApplied = s.defaultBasePath ?? ''; this.folderApplied = s.libraryFolder;
        this.baseDraft ??= this.baseApplied; this.folderDraft ??= this.folderApplied;
        new Setting(el).setName('Gallery').setHeading();
        this.baseSettings(el);
        new Setting(el).setName('Indexing').setHeading();
        new Setting(el).setName('Index scope').setDesc('Attachment scope is independent of base filters. Reference safety always covers the whole vault.').addDropdown(d => d.addOptions({ vault: 'Entire Vault', folder: 'Attachment folder' }).setValue(s.indexScope).onChange(async v => { s.indexScope = v === 'folder' ? 'folder' : 'vault'; await this.action(() => this.plugin.saveSettings()); }));
        if (s.indexScope === 'folder') new Setting(el).setName('Attachment folder').addText(t => t.setValue(s.attachmentsFolder).onChange(async v => { s.attachmentsFolder = v.trim().replace(/^\/+|\/+$/g, '') || 'Attachments'; await this.plugin.saveSettings(); }));
        this.folderSettings(el);
        new Setting(el).setName('Extensions').setDesc('Attachment whitelist. Markdown, bases, canvas, hidden folders and index notes are always excluded.').addText(t => t.setValue(s.watchedExtensions.join(', ')).onChange(async v => { s.watchedExtensions = normalizeExtensions(v.split(',')); await this.plugin.saveSettings(); }));
        new Setting(el).setName('Create indexes for new attachments').setDesc('Only future attachments. Enabling this does not scan existing files or require a full scan.').addToggle(t => t.setValue(s.autoCreateOnNew).onChange(async v => { await this.action(() => this.plugin.setAutoCreate(v)); }));
        new Setting(el).setName('Managed properties').setHeading();
        new Setting(el).setName('Required properties').setDesc(Object.entries(MANAGED_TYPES).map(([key, type]) => key + ': ' + type).join(' · ') + '. User properties such as source and tags are not managed.');
        const check = this.plugin.propertyTypes?.check();
        new Setting(el).setName('Property types').setDesc(!check?.available ? 'Native registration unavailable or still preparing. Use Obsidian Properties to set types when unavailable.' : check.conflicts.length ? check.conflicts.map(c => c.key + ': expected ' + c.expected + (c.assigned ? ', assigned ' + c.assigned : '') + '; ' + c.paths.join(', ')).join('\n') : check.missing.length ? 'Unregistered: ' + check.missing.join(', ') : 'All required types are registered.').addButton(b => b.setButtonText('Check types').onClick(() => { void this.action(() => this.plugin.checkPropertyTypes()); })).addButton(b => b.setButtonText('Register compatible types').onClick(() => { void this.action(() => this.plugin.checkPropertyTypes(true)); }));
        new Setting(el).setName('Image button').setHeading();
        new Setting(el).setName('Auto-hide image button').setDesc('Show the right-edge index button on hover or focus.').addToggle(t => t.setValue(s.imageButtonAutoHide).onChange(async v => { s.imageButtonAutoHide = v; await this.plugin.saveSettings(); this.plugin.images.refresh(); }));
        new Setting(el).setName('Command/ctrl-click').addDropdown(d => d.addOptions({ index: 'Open URL', nativeCmdClick: 'Open index in a new tab' }).setValue(s.imageClickMode).onChange(async v => { s.imageClickMode = v === 'nativeCmdClick' ? 'nativeCmdClick' : 'index'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Maintenance').setHeading();
        new Setting(el).setName('Scan attachments').setDesc('Choose the configured scope or one folder. Preview new indexes and required-property repairs.').addButton(b => b.setButtonText('Scan…').onClick(() => { void this.action(() => this.plugin.runBackfill()); }));
        new Setting(el).setName('Migrate index properties').setDesc('Preview legacy fields, conflicts and base dependencies. Back up before applying. No startup migration.').addButton(b => b.setButtonText('Migrate…').onClick(() => { void this.action(() => this.plugin.migrateProperties()); }));
        new Setting(el).setName('Repair gallery views').setDesc('Preview repairs to plugin-owned views in the default base.').addButton(b => b.setButtonText('Preview…').onClick(() => { void this.action(() => this.plugin.reviewLibraryConfiguration()); }));
        new Setting(el).setName('Rebuild reference index').setDesc('Read all reference sources. Routine updates use the incremental cache.').addButton(b => b.setButtonText('Rebuild').onClick(() => { void this.action(() => this.plugin.rebuildReferences()); }));
        new Setting(el).setName('Recent operation report').setDesc(this.plugin.recentReport + (this.plugin.store.lastReport ? '\nRecovery: ' + this.plugin.store.lastReport : ''));
        new Setting(el).setName('Command shortcuts').setDesc('Three commands: Open attachment gallery; Update current attachment…; Scan attachments…. If you used refresh references or review library configuration, rebind its shortcut manually.');
    }
}
