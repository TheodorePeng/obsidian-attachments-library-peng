import { expect, it, vi } from 'vitest';
import Plugin from '../src/main';
import { fixture } from './fixture';
import { DEFAULT_SETTINGS } from '../src/types';
import { settingsFromSaved } from '../src/gallery-destination';
import { readDocument } from '../src/registry';
vi.mock('../src/i18n/i18n',()=>({initI18n:vi.fn(async()=>{}),t:(key:string)=>key}));
const base='views:\n - type: attachments-library-peng\n   name: My gallery\n   alpOwned: attachments-library-peng:all\n';
async function setup(contents:Record<string,string>={},saved:any={settingsVersion:2,autoCreateOnNew:false}) {
    const f=fixture(contents), p=new Plugin(f.app); p.loadData=vi.fn(async()=>saved); p.saveData=vi.fn(async()=>{}); p.store.save=vi.fn(async()=> 'private-backup'); await p.onload(); await p.ready; return {...f,p};
}
const flush=async(p:Plugin)=>{await (p as any).eventQueue;};
it('distinguishes first install from explicit choices and legacy effective settings',async()=>{
    const f=fixture({}); for(const saved of [null,{}])expect((await settingsFromSaved(f.app,saved)).autoCreateOnNew).toBe(true);
    for(const enabled of [true,false])for(const scanned of [true,false])expect((await settingsFromSaved(f.app,{autoCreateOnNew:enabled,initialScanComplete:scanned})).autoCreateOnNew).toBe(enabled&&scanned);
    expect((await settingsFromSaved(f.app,{settingsVersion:2})).autoCreateOnNew).toBe(false);
    for(const enabled of [true,false])expect((await settingsFromSaved(f.app,{settingsVersion:2,autoCreateOnNew:enabled})).autoCreateOnNew).toBe(enabled);
});
it('previews a whole sorted batch with unique paths; apply matches the preview and preserves user notes',async()=>{
    const f=await setup({'B/photo.png':'b','A/photo.png':'a','Library/photo.png.md':'User note'}); const plan=await f.p.updates.preview(['B/photo.png','A/photo.png','B/photo.png']);
    expect(plan.map(i=>i.indexPath)).toEqual(['Library/photo.png (2).md','Library/photo.png (3).md']); expect(f.writes).toEqual([]);
    await f.p.updates.apply(plan); for(const item of plan)expect(readDocument(f.data.get(item.indexPath!)!).metadata._filePath).toBe(item.assetPath);
    expect(f.data.get('Library/photo.png.md')).toBe('User note'); expect(f.folders.has('Library/A')).toBe(false);
});
it('refuses stale planned folders, occupied paths and changed attachment identities',async()=>{
    const f=await setup({'a.png':'x','b.png':'x','c.png':'x'}); let plan=await f.p.updates.preview(['a.png']); await f.p.setIndexFolder('Meta');
    expect((await f.p.updates.apply(plan))[0]).toContain('folder changed'); expect(f.files.has('Meta/a.png.md')).toBe(false);
    plan=await f.p.updates.preview(['b.png']); await f.app.vault.create(plan[0].indexPath,'user'); expect((await f.p.updates.apply(plan))[0]).toContain('occupied'); expect(f.data.get(plan[0].indexPath!)).toBe('user'); expect(f.files.has('Meta/b.png (2).md')).toBe(false);
    plan=await f.p.updates.preview(['c.png']); f.add('c.png'); expect((await f.p.updates.apply(plan))[0]).toContain('identity');
});
it('serializes concurrent creators and reuses indexes created since a preview',async()=>{
    const f=await setup({'A/a.png':'x','B/a.png':'x'}); const plan=await f.p.updates.preview(['A/a.png']);
    await Promise.all([f.p.sidecarManager.createSidecar(f.files.get('A/a.png')!),f.p.sidecarManager.createSidecar(f.files.get('A/a.png')!),f.p.sidecarManager.createSidecar(f.files.get('B/a.png')!)]);
    expect(f.app.vault.create.mock.calls).toHaveLength(2); expect((await f.p.updates.apply(plan))[0]).toContain('existing:'); expect(f.p.registry.records.get('B/a.png')?.indexPath).toBe('Library/a.png (2).md');
});
it('retries automatic name allocation after external path occupation without replacing that file',async()=>{
    const f=await setup({'a.png':'x'}); const create=f.app.vault.create.getMockImplementation()!; let first=true;
    f.app.vault.create.mockImplementation(async(path:string,text:string)=>{if(first){first=false;await create(path,'External note');throw Error('occupied');}return create(path,text);});
    await f.p.sidecarManager.createSidecar(f.files.get('a.png')!); expect(f.data.get('Library/a.png.md')).toBe('External note'); expect(f.p.registry.records.get('a.png')?.indexPath).toBe('Library/a.png (2).md');
});
it('keeps the existing legacy index across folder changes and reloads without touching its body',async()=>{
    const text='---\n_filePath: A/a.png\nattachment: "[[A/a.png]]"\ncustom: retained\n---\nOCR'; const f=await setup({'A/a.png':'x','Library/A/a.png.md':text});
    await f.p.setIndexFolder('Meta'); expect(f.p.settings.legacyIndexPaths).toContain('Library/A/a.png.md'); await f.p.sidecarManager.createSidecar(f.files.get('A/a.png')!); expect(f.data.get('Library/A/a.png.md')).toBe(text);
    const next=new Plugin(f.app); next.loadData=vi.fn(async()=>f.p.settings); await next.onload(); await next.ready; expect(next.registry.records.get('A/a.png')?.indexPath).toBe('Library/A/a.png.md'); expect(f.files.has('Meta/a.png.md')).toBe(false);
});
it('creates only at root, prevents duplicate clicks and never binds an occupied file',async()=>{
    const f=await setup({'Taken.base':'views: []'}); await expect(f.p.createGallery('Taken')).rejects.toThrow('exists');
    const create=f.app.vault.create.getMockImplementation()!; let release!:()=>void; const gate=new Promise<void>(r=>release=r);
    f.app.vault.create.mockImplementation(async(path:string,text:string)=>{await gate;return create(path,text);});
    const pending=f.p.createGallery(); await expect(f.p.createGallery()).rejects.toThrow('running'); await expect(f.p.selectBase('Taken.base')).rejects.toThrow('running'); release(); await pending;
    expect(f.p.settings.defaultBasePath).toBe('Attachment Index.base'); expect(f.p.settings.defaultViewName).toBeTruthy(); await f.p.createGallery('Another'); expect(f.p.settings.defaultBasePath).toBe('Another.base');
    await f.p.clearBase(); expect(f.files.has('Attachment Index.base')).toBe(true); expect(f.p.settings.defaultViewOwner).toBe('');
});
it('preserves old Base on validation or save failure and leaves a created file available for recovery',async()=>{
    const f=await setup({'A.base':base,'Broken.base':'views: ['}); await f.p.selectBase('A.base');
    await expect(f.p.selectBase('')).rejects.toThrow('relative'); await expect(f.p.selectBase('Broken.base')).rejects.toThrow(); expect(f.p.settings.defaultBasePath).toBe('A.base');
    f.p.saveData=vi.fn(async()=>{throw Error('disk full');}); await expect(f.p.clearBase()).rejects.toThrow('disk full'); expect(f.p.settings.defaultBasePath).toBe('A.base');
    f.p.saveData=vi.fn(async()=>{}); await f.p.clearBase(); f.p.saveData=vi.fn(async()=>{throw Error('disk full');});
    await expect(f.p.createGallery('Recover')).rejects.toThrow('Created Recover.base'); expect(f.p.settings.defaultBasePath).toBe(''); expect(f.files.has('Recover.base')).toBe(true);
    f.p.saveData=vi.fn(async()=>{}); await f.p.selectBase('Recover.base'); expect(f.p.settings.defaultBasePath).toBe('Recover.base');
});
it('handles creation/read errors, stopped creators and case-equivalent destinations',async()=>{
    const f=await setup({'TAKEN.BASE':'views: []'}); await expect(f.p.createGallery('taken.base')).rejects.toThrow('exists'); f.folder('Directory.base'); await expect(f.p.createGallery('Directory.base')).rejects.toThrow('exists');
    f.app.vault.create.mockRejectedValueOnce(Error('no permission')); await expect(f.p.createGallery('Denied')).rejects.toThrow('no permission');
    const read=f.app.vault.cachedRead; f.app.vault.cachedRead=async(file:any)=>{if(file.path==='Read.base')throw Error('read failed');return read(file);}; await expect(f.p.createGallery('Read')).rejects.toThrow('Created Read.base');
    f.p.basesCreator.isActive=()=>false; await expect(f.p.basesCreator.createNewBaseFile('Stopped')).rejects.toThrow('stopped');
});
it('selects unique/default views, leaves ambiguous views unset, and accepts a native-only Base',async()=>{
    const f=await setup({'All.base':base+' - type: attachments-library-peng\n   name: Other\n','Unique.base':'views:\n - type: attachments-library-peng\n   name: Unique\n','Many.base':'views:\n - type: attachments-library-peng\n   name: One\n - type: attachments-library-peng\n   name: Two\n','Native.base':'filters: file.ext == "md"'});
    await f.p.selectBase('All.base'); expect(f.p.settings.defaultViewName).toBe('My gallery'); await f.p.selectBase('All.base'); expect(f.p.settings.defaultViewName).toBe('My gallery');
    await f.p.selectBase('Unique.base'); expect(f.p.settings.defaultViewName).toBe('Unique'); await f.p.selectBase('Many.base'); expect(f.p.settings.defaultViewName).toBe(''); await f.p.selectBase('Native.base'); expect(f.p.settings.defaultViewName).toBe('');
});
it('does not create during initialization or retroactively enable already queued events',async()=>{
    const f=fixture({'a.png':'x','b.png':'x'}); let layout!:()=>void; f.app.workspace.onLayoutReady=(cb:()=>void)=>layout=cb; const p=new Plugin(f.app); p.loadData=vi.fn(async()=>null); await p.onload();
    f.events.create(f.files.get('a.png')); layout(); await p.ready; await flush(p); expect(f.writes).toEqual([]);
    await p.setAutoCreate(false); f.events.create(f.files.get('b.png')); await p.setAutoCreate(true); await flush(p); expect(f.writes).toEqual([]);
    f.events.create(f.files.get('b.png')); await flush(p); expect(f.files.has('Attachment Library/b.png.md')).toBe(true); expect(p.settings.defaultBasePath).toBe('');
});
it('cancels queued automatic creations even if automation is re-enabled before the queue runs',async()=>{
    const f=await setup({'a.png':'x'},null); let release!:()=>void; (f.p as any).eventQueue=new Promise<void>(r=>release=r);
    f.events.create(f.files.get('a.png')); await f.p.setAutoCreate(false); await f.p.setAutoCreate(true); release(); await flush(f.p); expect(f.writes).toEqual([]);
    f.p.saveData=vi.fn(async()=>{throw Error('save error');}); await expect(f.p.setAutoCreate(false)).rejects.toThrow(); expect(f.p.settings.autoCreateOnNew).toBe(true);
});
it('tracks Base and index folder parents without relocating unrelated legacy indexes',async()=>{
    const f=await setup({'Old/A.base':base},{...DEFAULT_SETTINGS,defaultBasePath:'Old/A.base',libraryFolder:'Old/Indexes',autoCreateOnNew:false});
    const parent=f.folders.get('Old')!; parent.path='Moved'; f.events.rename(parent,'Old'); await flush(f.p); expect(f.p.settings.defaultBasePath).toBe('Moved/A.base'); expect(f.p.settings.libraryFolder).toBe('Moved/Indexes'); expect(f.app.fileManager.renameFile).not.toHaveBeenCalled();
});

it('revalidates a remembered default when applying the same Base after its views change',async()=>{const f=await setup({'A.base':base});await f.p.selectBase('A.base');f.data.set('A.base','views:\n - type: attachments-library-peng\n   name: Replacement\n');await f.p.selectBase('A.base');expect(f.p.settings.defaultViewName).toBe('Replacement');expect(f.p.settings.defaultViewOwner).toBe('');});
