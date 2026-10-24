import { App, PluginSettingTab, Setting } from 'obsidian';
import type AttachmentsLibraryPlugin from './main';
import { normalizeExtensions } from './file-policy';
export class AttachmentsLibrarySettingsTab extends PluginSettingTab {
    constructor(app: App, private plugin: AttachmentsLibraryPlugin) { super(app, plugin); }
    display(): void {
        const el = this.containerEl;
        el.empty();
        const s = this.plugin.settings;
        new Setting(el).setName('Indexing').setHeading();
        new Setting(el).setName('Index scope').setDesc('Reference checks always scan the whole vault. Markdown, canvas, bases, hidden folders and library are always excluded from attachment indexing.').addDropdown(drop => drop.addOptions({ vault: 'Entire Vault', folder: 'Attachment folder' }).setValue(s.indexScope).onChange(async (value) => { s.indexScope = value === 'folder' ? 'folder' : 'vault'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Attachment folder').addText(text => text.setValue(s.attachmentsFolder).onChange(async (value) => { s.attachmentsFolder = value.trim().replace(/^\/+|\/+$/g, '') || 'Attachments'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Library folder').setDesc('Existing metadata documents remain at their current location.').addText(text => text.setValue(s.libraryFolder).onChange(async (value) => { s.libraryFolder = value.trim().replace(/^\/+|\/+$/g, '') || 'Library'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Extensions').setDesc('Comma separated extension whitelist.').addText(text => text.setValue(s.watchedExtensions.join(', ')).onChange(async (value) => { s.watchedExtensions = normalizeExtensions(value.split(',')); await this.plugin.saveSettings(); }));
        new Setting(el).setName('Create indexes for new attachments').setDesc('Enabled only after the first confirmed full scan. External deletion always preserves the metadata document.').addToggle(toggle => toggle.setValue(s.autoCreateOnNew).onChange(async (value) => { s.autoCreateOnNew = value; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Image button cmd/ctrl-click').addDropdown(drop => drop.addOptions({ index: 'Open source URL', nativeCmdClick: 'Native internal link behavior' }).setValue(s.imageClickMode).onChange(async (value) => { s.imageClickMode = value === 'nativeCmdClick' ? 'nativeCmdClick' : 'index'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Base folder').setDesc('Applies to the next explicit open/create command. Existing base files are never replaced or moved automatically.').addText(text => text.setValue(s.baseFolderPath).onChange(async (value) => { s.baseFolderPath = value.trim(); await this.plugin.saveSettings(); }));
        new Setting(el).setName('Tags property').addText(text => text.setValue(s.tagsPropertyName).onChange(async (value) => { s.tagsPropertyName = value.trim() || 'tags'; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Extract PDF document metadata').setDesc('Reads local PDF title, author, subject and keywords only when creating a new index.').addToggle(toggle => toggle.setValue(s.enablePdfMetadataExtraction).onChange(async (value) => { s.enablePdfMetadataExtraction = value; await this.plugin.saveSettings(); }));
        new Setting(el).setName('Scan and index').setDesc('Previews new documents before adopting usage fields. Existing ocr and note bodies are preserved.').addButton(button => button.setButtonText('Preview full scan').onClick(() => { void this.plugin.runBackfill(); }));
        new Setting(el).setName('Open library').setDesc('Creates a new base or backs up and appends owned views to the existing base.').addButton(button => button.setButtonText('Open library').onClick(() => { void this.plugin.openLibrary(); }));
        new Setting(el).setName('Refresh references').addButton(button => button.setButtonText('Refresh').onClick(() => { void this.plugin.refreshUsage(); }));
    }
}
