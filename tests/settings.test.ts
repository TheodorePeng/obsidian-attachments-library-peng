// @vitest-environment happy-dom
import { it, expect, vi } from 'vitest';
import { settingInstances, noticeMessages, modalInstances, inputSuggestInstances, menuInstances, FileSystemAdapter } from 'obsidian';
import { AttachmentsLibrarySettingsTab } from '../src/settings';
import { GalleryConnection } from '../src/gallery-connection';
import Plugin from '../src/main';
import { fixture } from './fixture';
vi.mock('../src/i18n/i18n', () => ({ initI18n: vi.fn(async () => {}), t: (key: string) => key }));
const base = 'views:\n - type: attachments-library-peng\n   name: Gallery\n   alpOwned: attachments-library-peng:all\n';
async function setup() {
    const f = fixture({'Custom.base':base}); const plugin = new Plugin(f.app); await plugin.onload(); await plugin.ready;
    plugin.propertyTypes.check = () => ({available:true,conflicts:[],missing:[]});
    const tab = new AttachmentsLibrarySettingsTab(f.app, plugin); document.body.replaceChildren(tab.containerEl);
    const draw = () => { settingInstances.length=0; tab.display(); }; draw();
    const find = (name:string) => [...settingInstances].reverse().find(s=>s.name===name);
    const input = () => tab.containerEl.querySelector('#alp-index-folder') as HTMLInputElement;
    const button = (label:string, root:HTMLElement=tab.containerEl) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;
    const type = (value:string, node=input()) => {node.value=value;node.dispatchEvent(new Event('input'));};
    return {...f,plugin,tab,find,draw,input,button,type};
}
it('keeps folder drafts until Save, reports errors inline, preserves focus and creates no directory', async()=>{
    const f=await setup(); for(const name of ['Gallery','Indexing','Existing library','Image interaction','Maintenance & recovery'])expect(f.find(name)).toBeTruthy();
    expect(f.button('Save location').disabled).toBe(true); f.type('资料/索引'); expect(f.plugin.settings.libraryFolder).toBe('Library');
    const input=f.input();input.focus();f.button('Save location').click();await vi.waitFor(()=>expect(f.plugin.settings.libraryFolder).toBe('资料/索引'));expect(f.input()).toBe(input);expect(f.app.vault.createFolder).not.toHaveBeenCalled();expect(f.tab.containerEl.textContent).toContain('Saved: 资料/索引');
    f.type('Custom.base');f.button('Save location').click();await vi.waitFor(()=>expect(f.tab.containerEl.querySelector('[role=alert]')?.textContent).toContain('This is a Base file'));expect(f.input().value).toBe('Custom.base');expect(f.plugin.settings.libraryFolder).toBe('资料/索引');
    f.button('Cancel changes').click();expect(f.input().value).toBe('资料/索引');f.type('');f.button('Save location').click();await vi.waitFor(()=>expect(f.tab.containerEl.querySelector('[role=alert]')).toBeTruthy());
    f.tab.hide();f.draw();expect(f.input().value).toBe('资料/索引');
});
it('handles save failure, suggestions, moves, absolute paths and Chinese composition without losing drafts',async()=>{
    const f=await setup();inputSuggestInstances.at(-1).selectSuggestion('Draft folder',new MouseEvent('click'));expect(f.input().value).toBe('Draft folder');expect(f.plugin.settings.libraryFolder).toBe('Library');
    f.plugin.settings.libraryFolder='Moved';f.tab.pathsChanged();expect(f.input().value).toBe('Draft folder');expect(f.tab.containerEl.textContent).toContain('draft is preserved');
    const persist=vi.spyOn(f.plugin,'saveData').mockRejectedValueOnce(Error('disk denied'));f.button('Save location').click();await vi.waitFor(()=>expect(f.tab.containerEl.textContent).toContain('disk denied'));expect(f.input().value).toBe('Draft folder');expect(f.plugin.settings.libraryFolder).toBe('Moved');persist.mockRestore();
    f.button('Cancel changes').click();f.type('Absolute');f.input().dispatchEvent(new Event('compositionstart'));f.button('Save location').click();expect(f.plugin.settings.libraryFolder).toBe('Moved');f.input().dispatchEvent(new Event('compositionend'));
    Object.setPrototypeOf(f.app.vault.adapter,FileSystemAdapter.prototype);f.app.vault.adapter.getBasePath=()=>'/vault';f.type('/vault/中文 空格');f.button('Save location').click();await vi.waitFor(()=>expect(f.plugin.settings.libraryFolder).toBe('中文 空格'));
    const suggest=inputSuggestInstances.at(-1);f.tab.hide();expect(suggest.closed).toBe(true);f.tab.pathsChanged();f.draw();expect(f.input().value).toBe('中文 空格');
});
it('uses one connection modal for file and view, keeps cancel atomic and allows an unmarked view',async()=>{
    const f=await setup();f.data.set('Other.base','views:\n - type: attachments-library-peng\n   name: Manual\n');f.add('Other.base');
    f.button('Connect gallery…').click();let modal=modalInstances.at(-1) as GalleryConnection;const node=modal.contentEl.querySelector('input') as HTMLInputElement;
    f.type('Other.base',node);await vi.waitFor(()=>expect(modal.contentEl.textContent).toContain('Compatible gallery found'));expect(f.plugin.settings.defaultBasePath).toBe('');f.button('Cancel',modal.contentEl).click();expect(f.plugin.settings.defaultBasePath).toBe('');
    f.button('Connect gallery…').click();modal=modalInstances.at(-1);f.type('Other.base',modal.contentEl.querySelector('input')!);await vi.waitFor(()=>expect(f.button('Save connection',modal.contentEl).disabled).toBe(false));f.button('Save connection',modal.contentEl).click();await vi.waitFor(()=>expect(f.plugin.settings.defaultViewName).toBe('Manual'));expect(f.plugin.settings.defaultBasePath).toBe('Other.base');f.draw();await vi.waitFor(()=>expect(f.tab.containerEl.textContent).toContain('Ready'));expect(f.button('Connect gallery…')).toBeUndefined();
    f.button('More…').click();menuInstances.at(-1).items.find((i:any)=>i.title==='Disconnect').callback();await vi.waitFor(()=>expect(f.plugin.settings.defaultBasePath).toBe(''));expect(f.files.has('Other.base')).toBe(true);
});
it('isolates new-Base mode, prevents duplicate creation, and shows precise broken connection states',async()=>{
    const f=await setup();f.button('Connect gallery…').click();const modal=modalInstances.at(-1);f.button('New Base',modal.contentEl).click();const input=modal.contentEl.querySelector('input') as HTMLInputElement;
    f.type('../bad',input);expect(f.button('Create and connect',modal.contentEl).disabled).toBe(true);f.type('New gallery',input);f.button('Create and connect',modal.contentEl).click();f.button('Create and connect',modal.contentEl).click();await vi.waitFor(()=>expect(f.plugin.settings.defaultBasePath).toBe('New gallery.base'));expect(f.writes.filter(p=>p==='New gallery.base')).toHaveLength(1);
    for(const [value,expected] of [['views: []','No compatible'],['views: [','Invalid'],[base.replace('   alpOwned: attachments-library-peng:all\n',''),'Default view missing']]){f.data.set('New gallery.base',value);f.draw();await vi.waitFor(()=>expect(f.tab.containerEl.textContent).toContain(expected));expect(f.button('Fix connection…')).toBeTruthy();}
    f.files.delete('New gallery.base');f.draw();await vi.waitFor(()=>expect(f.tab.containerEl.textContent).toContain('missing'));
});
it('routes maintenance, scope and image controls and reports operation failures',async()=>{
    const f=await setup();await f.find('Index scope').dropdownCallbacks[0]('folder');expect(f.find('Attachment folder')).toBeTruthy();await f.find('Attachment folder').textCallbacks[0](' /图片/ ');expect(f.plugin.settings.attachmentsFolder).toBe('图片');
    f.find('Extensions').textCallbacks[0]('PNG, .md, .PDF');await Promise.resolve();expect(f.plugin.settings.watchedExtensions).toEqual(['.png','.pdf']);
    await f.find('Create indexes for new attachments').toggleCallbacks[0](false);expect(f.plugin.settings.autoCreateOnNew).toBe(false);await f.find('Auto-hide image button').toggleCallbacks[0](false);await f.find('Command/ctrl-click').dropdownCallbacks[0]('nativeCmdClick');await f.find('Command/ctrl-click').dropdownCallbacks[0]('bad');
    for(const [name,method] of [['Property types','checkPropertyTypes'],['Scan attachments','runBackfill'],['Migrate index properties','migrateProperties'],['Repair gallery views','reviewLibraryConfiguration'],['Rebuild reference index','rebuildReferences']] as const){const spy=vi.spyOn(f.plugin,method).mockResolvedValue(undefined as never);for(const cb of f.find(name).buttonCallbacks)cb();await vi.waitFor(()=>expect(spy).toHaveBeenCalled());}
    await f.plugin.selectBase('Custom.base');f.draw();vi.spyOn(f.plugin,'openLibrary').mockRejectedValueOnce(Error('missing target'));f.button('Open gallery').click();await vi.waitFor(()=>expect(noticeMessages).toContain('missing target'));
    f.plugin.propertyTypes.check=()=>({available:false,conflicts:[],missing:[]});f.draw();f.plugin.propertyTypes.check=()=>({available:true,conflicts:[{key:'keep',expected:'checkbox',assigned:'text',paths:['a.md']}],missing:[]});f.draw();f.plugin.propertyTypes.check=()=>({available:true,conflicts:[],missing:['keep']});f.draw();
});
