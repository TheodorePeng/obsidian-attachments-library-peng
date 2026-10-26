import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AttachmentsLibraryPlugin from './main';
import { normalizeExtensions } from './file-policy';
import { MANAGED_TYPES } from './managed-properties';
export class AttachmentsLibrarySettingsTab extends PluginSettingTab {
    constructor(app: App, private plugin: AttachmentsLibraryPlugin) { super(app, plugin); }
    private async action(action: () => Promise<void>): Promise<void> { try { await action(); this.display(); } catch (error) { new Notice(error instanceof Error ? error.message : 'Operation failed'); } }
    display(): void {
        const el = this.containerEl; el.empty(); const s = this.plugin.settings;
        new Setting(el).setName('Gallery').setHeading();
        new Setting(el).setName('Default base file').setDesc(s.defaultBasePath || 'Not selected. Any Base file can use the attachment gallery. This choice only controls the open command.').addButton(b => b.setButtonText('Choose file…').onClick(() => { void this.action(() => this.plugin.selectBase()); })).addButton(b => b.setButtonText('Open').onClick(() => { void this.action(() => this.plugin.openLibrary()); })).addButton(b => b.setButtonText('Create base…').onClick(() => { void this.action(() => this.plugin.createGallery()); }));
        new Setting(el).setName('Default view').setDesc(s.defaultViewName || 'Not selected. Choose a gallery view in the default base.').addButton(b => b.setButtonText('Choose view…').onClick(() => { void this.action(() => this.plugin.selectDefaultView()); }));
        new Setting(el).setName('Indexing').setHeading();
        new Setting(el).setName('Index scope').setDesc('Attachment scope is independent of base filters. Reference safety always covers the whole vault.').addDropdown(d => d.addOptions({ vault: 'Entire Vault', folder: 'Attachment folder' }).setValue(s.indexScope).onChange(async v => { s.indexScope = v === 'folder' ? 'folder' : 'vault'; await this.action(() => this.plugin.saveSettings()); }));
        if (s.indexScope === 'folder') new Setting(el).setName('Attachment folder').addText(t => t.setValue(s.attachmentsFolder).onChange(async v => { s.attachmentsFolder = v.trim().replace(/^\/+|\/+$/g, '') || 'Attachments'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Index notes folder').setDesc('Location for new index notes. Existing notes are never moved.').addText(t => t.setValue(s.libraryFolder).onChange(async v => { s.libraryFolder = v.trim().replace(/^\/+|\/+$/g, '') || 'Library'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Extensions').setDesc('Attachment whitelist. Markdown, bases, canvas, hidden folders and index notes are always excluded.').addText(t => t.setValue(s.watchedExtensions.join(', ')).onChange(async v => { s.watchedExtensions = normalizeExtensions(v.split(',')); await this.plugin.saveSettings(); }));
        new Setting(el).setName('Create indexes for new attachments').setDesc('Only future attachments. Enabling this does not scan existing files or require a full scan.').addToggle(t => t.setValue(s.autoCreateOnNew).onChange(async v => { s.autoCreateOnNew = v; await this.plugin.saveSettings(); }));
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
