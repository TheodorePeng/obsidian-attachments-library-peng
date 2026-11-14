// @vitest-environment happy-dom
import { it, expect, vi } from 'vitest';
import { modalInstances, settingInstances } from 'obsidian';
import { GalleryConnection } from '../src/gallery-connection';
import { restoreLibraryDialog, recoveryDialog } from '../src/library-dialogs';
import { LibraryRestore } from '../src/library-restore';
import { confirmAction } from '../src/dialogs';
import { DeletionRecovery } from '../src/deletion-recovery';
import { DeletionService } from '../src/deletions';
import { confirmDeletion, renderReview } from '../src/delete-preview';
import { AttachmentRegistry } from '../src/registry';
import { ReferenceService } from '../src/references';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
vi.mock('../src/dialogs',()=>({confirmAction:vi.fn(async()=>true)}));
const base='views:\n - type: attachments-library-peng\n   name: One\n - type: attachments-library-peng\n   name: Two\n';
const click=(root:HTMLElement,label:string)=>{const b=[...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;b.click();return b;};
const type=(root:HTMLElement,value:string)=>{const input=root.querySelector('input')!;input.value=value;input.dispatchEvent(new Event('input'));};
async function tick(check:()=>void){await vi.waitFor(check);}
function setup(contents:Record<string,string>={}){
    const f=fixture({'Any.base':base,...contents}); const registry=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});
    const plugin:any={isRunning:()=>true,settings:{...DEFAULT_SETTINGS},registry,store:{save:vi.fn(async()=> 'backup'),lastReport:'backup'},propertyEdits:{hasPending:()=>false},deletions:{ownsPath:()=>false,restoreJournal:vi.fn(async()=>[]),recovery:{issues:[],list:vi.fn(async()=>[]) }},connectGallery:vi.fn(async()=>{}),createGallery:vi.fn(async()=>{})};
    return {...f,plugin};
}
it('requires explicit view choice, ignores late lookups and keeps a rejected connection open',async()=>{
    const f=setup();let resolve:any;const read=f.app.vault.read;f.app.vault.read=vi.fn(async(file:any)=> file.path==='Any.base'?new Promise(r=>resolve=r):read(file));f.data.set('One.base',base.replace(/ - type: attachments-library-peng\n   name: Two\n/,''));f.add('One.base');
    const changed=vi.fn();const modal=new GalleryConnection(f.app,f.plugin,changed);modal.open();type(modal.contentEl,'Any.base');await tick(()=>expect(resolve).toBeTypeOf('function'));type(modal.contentEl,'One.base');await tick(()=>expect(modal.contentEl.textContent).toContain('Compatible'));resolve(base);await Promise.resolve();expect(modal.contentEl.querySelectorAll('option')).toHaveLength(2);
    f.plugin.connectGallery.mockRejectedValueOnce(Error('Base changed'));click(modal.contentEl,'Save connection');await tick(()=>expect(modal.contentEl.textContent).toContain('Base changed'));expect(changed).not.toHaveBeenCalled();
    type(modal.contentEl,'Any.base');resolve(base);await tick(()=>expect(modal.contentEl.querySelectorAll('option')).toHaveLength(3));const select=modal.contentEl.querySelector('select')!;select.value='Two';select.dispatchEvent(new Event('change'));click(modal.contentEl,'Save connection');await tick(()=>expect(changed).toHaveBeenCalledOnce());
});
it('previews adding a gallery to a native Base while preserving filters, comments and unrelated views',async()=>{
    const original='# comment\nfilters: file.inFolder("Custom")\nviews:\n - type: table\n   name: Native\n';const f=setup({'Native.base':original});const modal=new GalleryConnection(f.app,f.plugin,()=>{});modal.open();type(modal.contentEl,'Native.base');await tick(()=>expect(modal.contentEl.textContent).toContain('No compatible'));
    vi.mocked(confirmAction).mockResolvedValueOnce(false);click(modal.contentEl,'Add gallery view…');await tick(()=>expect(vi.mocked(confirmAction).mock.calls.at(-1)?.[1]).toBe('Add gallery view'));expect(f.writes).toEqual([]);
    click(modal.contentEl,'Add gallery view…');await tick(()=>expect(f.data.get('Native.base')).toContain('attachments-library-peng'));expect(f.data.get('Native.base')).toContain('# comment');expect(f.data.get('Native.base')).toContain('Native');expect(f.data.get('Native.base')).toContain('file.inFolder("Custom")');expect(f.plugin.store.save).toHaveBeenCalledOnce();modal.close();
});
it('handles explicit add failure, duplicate names, missing paths, new creation failure and IME suppression',async()=>{
    const f=setup({'Empty.base':'views: []'});let modal=new GalleryConnection(f.app,f.plugin,()=>{});modal.open();type(modal.contentEl,'Empty.base');await tick(()=>expect(modal.contentEl.textContent).toContain('No compatible'));f.plugin.store.save.mockRejectedValueOnce(Error('backup failure'));click(modal.contentEl,'Add gallery view…');await tick(()=>expect(modal.contentEl.textContent).toContain('backup failure'));expect(f.writes).toEqual([]);modal.close();
    f.data.set('Any.base',base.replace('Two','One'));modal=new GalleryConnection(f.app,f.plugin,()=>{});modal.open();type(modal.contentEl,'Any.base');await tick(()=>expect(modal.contentEl.querySelectorAll('option')).toHaveLength(3));expect([...modal.contentEl.querySelectorAll('option')].filter(o=>o.disabled)).toHaveLength(2);type(modal.contentEl,'missing.base');await tick(()=>expect(modal.contentEl.querySelector('[role=alert]')).toBeTruthy());
    click(modal.contentEl,'New Base');type(modal.contentEl,'New');const input=modal.contentEl.querySelector('input')!;input.dispatchEvent(new Event('compositionstart'));click(modal.contentEl,'Create and connect');expect(f.plugin.createGallery).not.toHaveBeenCalled();input.dispatchEvent(new Event('compositionend'));f.plugin.createGallery.mockRejectedValueOnce(Error('Created New.base, save failed'));click(modal.contentEl,'Create and connect');await tick(()=>expect(modal.contentEl.textContent).toContain('save failed'));modal.close();
});
it('discovers candidates, previews explicit adoption and shows service errors without background writes',async()=>{
    const legacy='---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\nOCR';const f=setup({'a.png':'x','old.md':legacy});const adopt=vi.spyOn(LibraryRestore.prototype,'adopt').mockResolvedValue(undefined);
    restoreLibraryDialog(f.app,f.plugin);const modal=modalInstances.at(-1);await tick(()=>expect(modal.contentEl.textContent).toContain('legacy candidates'));click(modal.contentEl,'Preview adoption…');expect(adopt).not.toHaveBeenCalled();const checkbox=modal.contentEl.querySelector('input')!;checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));vi.mocked(confirmAction).mockResolvedValueOnce(false);click(modal.contentEl,'Preview adoption…');await Promise.resolve();await Promise.resolve();expect(adopt).not.toHaveBeenCalled();
    click(modal.contentEl,'Preview adoption…');await tick(()=>expect(adopt).toHaveBeenCalledOnce());expect(f.writes).toEqual([]);modal.close();adopt.mockRestore();
    const discover=vi.spyOn(LibraryRestore.prototype,'discover').mockRejectedValue(Error('read failed'));restoreLibraryDialog(f.app,f.plugin);await tick(()=>expect(modalInstances.at(-1).contentEl.textContent).toContain('read failed'));modalInstances.at(-1).close();discover.mockRestore();
});
it('shows recovery records and explicit restore outcomes, errors and empty inventories',async()=>{
    const f=setup();recoveryDialog(f.app,f.plugin);await tick(()=>expect(modalInstances.at(-1).contentEl.textContent).toContain('No recovery'));modalInstances.at(-1).close();
    f.plugin.deletions.recovery.list.mockResolvedValue([{id:'qa',phase:'editing',files:[{path:'a.png'}],error:'interrupted'},{id:'done',phase:'restored',files:[]}]);
    recoveryDialog(f.app,f.plugin);let modal=modalInstances.at(-1);await tick(()=>expect(modal.contentEl.textContent).toContain('interrupted'));vi.mocked(confirmAction).mockResolvedValueOnce(false);click(modal.contentEl,'Review restoration…');await Promise.resolve();await Promise.resolve();expect(f.plugin.deletions.restoreJournal).not.toHaveBeenCalled();click(modal.contentEl,'Review restoration…');await tick(()=>expect(modal.contentEl.textContent).toContain('Restored originals'));modal.close();
    f.plugin.deletions.restoreJournal.mockResolvedValueOnce(['occupied']);recoveryDialog(f.app,f.plugin);modal=modalInstances.at(-1);await tick(()=>expect(modal.contentEl.textContent).toContain('interrupted'));click(modal.contentEl,'Review restoration…');await tick(()=>expect(modal.contentEl.textContent).toContain('Recovery required: occupied'));modal.close();
    f.plugin.deletions.recovery.list.mockRejectedValueOnce(Error('unreadable'));recoveryDialog(f.app,f.plugin);await tick(()=>expect(modalInstances.at(-1).contentEl.textContent).toContain('unreadable'));modalInstances.at(-1).close();
});
it('rechecks deletion previews and pages long diagnostics before requesting confirmation',async()=>{
    const f=fixture({});const plan:any={mode:'pair',targets:[],reviews:[],skipped:[{path:'a',reason:'keep'}],changes:[]};const next={...plan,token:'next',targets:[{files:[{path:'a'}]}],skipped:[],changes:[{path:'n.md',before:'[[a]]',after:'a',summary:'Unlink'}]};const recheck=vi.fn(async()=>next);const pending=confirmDeletion(f.app,plan,recheck);let actions=settingInstances.at(-1);await actions.buttonCallbacks[1]();expect(plan.token).toBe('next');actions=settingInstances.at(-1);actions.buttonCallbacks[2]();expect(await pending).toBe(true);
    const bad=confirmDeletion(f.app,{...plan,targets:[],skipped:[]},vi.fn(async()=>{throw Error('probe failed');}));await settingInstances.at(-1).buttonCallbacks[1]();expect(modalInstances.at(-1).contentEl.textContent).toContain('probe failed');modalInstances.at(-1).close();expect(await bad).toBe(false);
    const root=document.createElement('div');renderReview(f.app,root,{assetPath:'a',indexPaths:[],hasUserBody:false,usage:{count:1,assetSources:['n'],indexSources:[],occurrences:Array.from({length:25},()=>({sourcePath:'n',targetPath:'a',kind:'link'})),issues:Array.from({length:23},()=>({sourcePath:'bad',reason:'unknown',affectedPaths:null})),excluded:[],assetCheckComplete:false,indexCheckComplete:false} as any});expect(root.querySelectorAll('a').length).toBe(41);click(root,'Show next 20 references');expect(root.textContent).toContain('3 more');
});
