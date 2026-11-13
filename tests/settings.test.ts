// @vitest-environment happy-dom
import { it, expect, vi } from 'vitest';
import { settingInstances, noticeMessages, inputSuggestInstances } from 'obsidian';
import { AttachmentsLibrarySettingsTab } from '../src/settings';
import Plugin from '../src/main';
import { fixture } from './fixture';
vi.mock('../src/i18n/i18n', () => ({ initI18n: vi.fn(async () => {}), t: (key: string) => key }));
const base = 'views:\n - type: attachments-library-peng\n   name: Gallery\n   alpOwned: attachments-library-peng:all\n';
async function setup() {
    const f = fixture({'Custom.base':base}); const plugin = new Plugin(f.app); await plugin.onload(); await plugin.ready;
    plugin.propertyTypes.check = () => ({available:true,conflicts:[],missing:[]});
    const tab = new AttachmentsLibrarySettingsTab(f.app, plugin);
    const draw = () => { settingInstances.length=0; tab.display(); }; draw();
    const find = (name:string) => [...settingInstances].reverse().find(s=>s.name===name);
    const idle = async () => { await vi.waitFor(()=>expect((tab as any).busy).toBe(false)); draw(); };
    return {...f,plugin,tab,find,draw,idle};
}
it('keeps input drafts until Apply; new directory is not created by applying settings', async()=>{
    const f=await setup(); for(const name of ['Gallery','Indexing','Managed properties','Image button','Maintenance'])expect(f.find(name)).toBeTruthy();
    await f.find('Index scope').dropdownCallbacks[0]('folder'); expect(f.find('Attachment folder')).toBeTruthy();
    await f.find('Attachment folder').textCallbacks[0](' /图片/ '); expect(f.plugin.settings.attachmentsFolder).toBe('图片');
    f.find('Index notes folder').textCallbacks[0]('资料/索引'); expect(f.plugin.settings.libraryFolder).toBe('Library');
    f.find('Index notes folder').buttonCallbacks[0](); await f.idle(); expect(f.plugin.settings.libraryFolder).toBe('资料/索引'); expect(f.app.vault.createFolder).not.toHaveBeenCalled();
    f.find('Index notes folder').textCallbacks[0](''); f.find('Index notes folder').buttonCallbacks[0](); await f.idle(); expect(f.plugin.settings.libraryFolder).toBe('资料/索引'); expect(f.find('Path status').desc).toContain('relative');
    f.find('Extensions').textCallbacks[0]('PNG, .md, .PDF'); await Promise.resolve(); expect(f.plugin.settings.watchedExtensions).toEqual(['.png','.pdf']);
    await f.find('Index scope').dropdownCallbacks[0]('invalid'); f.draw(); expect(f.find('Attachment folder')).toBeUndefined();
});
it('makes setup modes exclusive, selects candidates as drafts, and clears only the association',async()=>{
    const f=await setup(); const select=vi.spyOn(f.plugin,'selectBase');
    expect(f.find('New base file')).toBeUndefined();
    const suggest=inputSuggestInstances.at(-2); suggest.selectSuggestion('Custom.base',new MouseEvent('click')); expect(select).not.toHaveBeenCalled(); expect(f.plugin.settings.defaultBasePath).toBe('');
    f.find('Default base file').buttonCallbacks[0](); await f.idle(); expect(f.plugin.settings.defaultBasePath).toBe('Custom.base'); expect(f.find('Base setup')).toBeUndefined(); expect(f.find('Default view')).toBeTruthy();
    const open=vi.spyOn(f.plugin,'openLibrary').mockRejectedValueOnce(Error('missing target')); f.find('Default base file').buttonCallbacks[1](); await vi.waitFor(()=>expect(noticeMessages).toContain('missing target')); expect(open).toHaveBeenCalled();
    f.find('Default base file').buttonCallbacks[2](); await f.idle(); expect(f.files.has('Custom.base')).toBe(true); expect(f.find('Default view')).toBeUndefined();
    f.find('Base setup').dropdownCallbacks[0]('create'); f.draw(); expect(f.find('Default base file')).toBeUndefined();
    f.find('New base file').textCallbacks[0]('../bad'); expect(f.find('New base file').desc).toContain('Invalid');
    f.find('New base file').textCallbacks[0]('New gallery'); f.find('New base file').buttonCallbacks[0](); f.find('New base file').buttonCallbacks[0](); await f.idle();
    expect(f.plugin.settings.defaultBasePath).toBe('New gallery.base'); expect(f.writes.filter(p=>p==='New gallery.base')).toHaveLength(1); expect(f.find('New base file')).toBeUndefined();
});
it('preserves drafts across moves and redraws; hide closes suggestions and discards drafts',async()=>{
    const f=await setup(); f.find('Default base file').textCallbacks[0]('My draft.base'); f.find('Index notes folder').textCallbacks[0]('Draft folder');
    f.plugin.settings.defaultBasePath='Moved.base'; f.plugin.settings.libraryFolder='Moved folder'; f.tab.pathsChanged();
    expect((f.tab as any).baseDraft).toBe('My draft.base'); expect((f.tab as any).folderDraft).toBe('Draft folder'); expect(f.find('Path status').desc).toContain('preserved');
    const suggestions=inputSuggestInstances.slice(-2); f.tab.hide(); expect(suggestions.every(s=>s.closed)).toBe(true); f.tab.pathsChanged(); f.draw();
    expect((f.tab as any).baseDraft).toBe('Moved.base'); expect((f.tab as any).folderDraft).toBe('Moved folder');
    f.plugin.settings.defaultBasePath='Again.base'; f.plugin.settings.libraryFolder='Again'; f.tab.pathsChanged(); expect((f.tab as any).baseDraft).toBe('Again.base'); expect((f.tab as any).folderDraft).toBe('Again');
    await Promise.resolve();
});
it('routes maintenance and image operations independently and reports Base status',async()=>{
    const f=await setup(); await f.find('Create indexes for new attachments').toggleCallbacks[0](false); expect(f.plugin.settings.autoCreateOnNew).toBe(false);
    await f.find('Auto-hide image button').toggleCallbacks[0](false); expect(f.plugin.settings.imageButtonAutoHide).toBe(false);
    await f.find('Command/ctrl-click').dropdownCallbacks[0]('nativeCmdClick'); expect(f.plugin.settings.imageClickMode).toBe('nativeCmdClick'); await f.find('Command/ctrl-click').dropdownCallbacks[0]('bad'); expect(f.plugin.settings.imageClickMode).toBe('index');
    for(const [name,method] of [['Property types','checkPropertyTypes'],['Scan attachments','runBackfill'],['Migrate index properties','migrateProperties'],['Repair gallery views','reviewLibraryConfiguration'],['Rebuild reference index','rebuildReferences']] as const) {
        const spy=vi.spyOn(f.plugin,method).mockResolvedValue(undefined as never); for(const cb of f.find(name).buttonCallbacks)cb(); await vi.waitFor(()=>expect(spy).toHaveBeenCalled());
    }
    await f.plugin.selectBase('Custom.base'); f.draw(); await Promise.resolve(); expect(f.find('Base status').desc).toContain('Selected');
    f.files.delete('Custom.base'); f.draw(); await Promise.resolve(); expect(f.find('Base status').desc).toContain('missing');
    f.data.set('Other.base','views: []'); f.add('Other.base'); await f.plugin.selectBase('Other.base'); f.draw(); await Promise.resolve(); expect(f.find('Base status').desc).toContain('No attachment');
    f.data.set('Other.base','views: ['); f.draw(); await Promise.resolve(); expect(f.find('Base status').desc).not.toContain('Selected');
    f.plugin.propertyTypes.check=()=>({available:false,conflicts:[],missing:[]}); f.draw();
    f.plugin.propertyTypes.check=()=>({available:true,conflicts:[{key:'keep',expected:'checkbox',assigned:'text',paths:['a.md']}],missing:[]}); f.draw();
    f.plugin.propertyTypes.check=()=>({available:true,conflicts:[],missing:['keep']}); f.draw();
});
