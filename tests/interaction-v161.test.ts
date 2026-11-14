// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { MarkdownView, modalInstances, settingInstances } from 'obsidian';
import { fixture } from './fixture';
import { DEFAULT_SETTINGS } from '../src/types';
import { settingsFromSaved } from '../src/gallery-destination';
import { AttachmentRegistry } from '../src/registry';
import { ReferenceService } from '../src/references';
import { DeletionService } from '../src/deletions';
import { confirmDeletion } from '../src/delete-preview';
import { confirmAction } from '../src/dialogs';
import Plugin from '../src/main';
vi.mock('../src/dialogs', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../src/i18n/i18n', () => ({ initI18n: vi.fn(async () => {}), t: (key: string) => key }));
const note = (keep: string) => `---\nal_schema: 1\n_filePath: a.png\nattachment: "[[a.png]]"\n${keep}\ncustom: keep me\n---\nOCR content`;
async function service(keep = 'keep: true') {
    const f = fixture({ 'a.png': 'image', 'Library/a.md': note(keep) });
    const r = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS }), refs = new ReferenceService(f.app, r), d = new DeletionService(f.app, r, refs);
    return { ...f, r, refs, d };
}
it('shows a simple reason and separately confirms turning off Keep before another deletion confirmation',async()=>{
    const f=await service(); const plan=await f.d.prepare(['a.png'],'pair'); expect(plan.reviews[0].blockCode).toBe('keep');
    const done=confirmDeletion(f.app,plan,()=>f.d.prepare(['a.png'],'pair'),path=>f.d.turnOffKeep(path)); const modal=modalInstances.at(-1);
    expect(modal.contentEl.textContent).toContain('“Keep” is turned on');expect(modal.contentEl.textContent.match(/Protected by keep/g)).toHaveLength(1);
    const unlock=[...modal.contentEl.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Turn off Keep…')!;
    vi.mocked(confirmAction).mockResolvedValueOnce(false);unlock.click();await vi.waitFor(()=>expect(unlock.disabled).toBe(false));expect(f.data.get('Library/a.md')).toContain('keep: true');
    unlock.click();await vi.waitFor(()=>expect(f.data.get('Library/a.md')).toContain('keep: false'));await vi.waitFor(()=>expect(plan.targets).toHaveLength(1));expect(f.files.has('a.png')).toBe(true);expect(f.app.vault.trash).not.toHaveBeenCalled();
    settingInstances.at(-1).buttonCallbacks[0]();expect(await done).toBe(false);expect(f.data.get('Library/a.md')).toContain('custom: keep me');expect(f.data.get('Library/a.md')).toContain('OCR content');
});
it('unlocks both equal flags, but refuses conflicts, invalid values, pending and unsaved edits',async()=>{
    const f=await service('keep: true\nal_keep: true');await f.d.turnOffKeep('Library/a.md');expect(f.data.get('Library/a.md')).toContain('keep: false');expect(f.data.get('Library/a.md')).toContain('al_keep: false');
    for(const flags of ['keep: true\nal_keep: false','keep: nope']){const g=await service(flags);expect((await g.d.prepare(['a.png'],'pair')).reviews[0].blockCode).toBe('invalid-keep');await expect(g.d.turnOffKeep('Library/a.md')).rejects.toThrow();expect(g.writes).toEqual([]);}
    const g=await service();g.d.hasPendingEdits=()=>true;await expect(g.d.turnOffKeep('Library/a.md')).rejects.toThrow('pending');g.d.hasPendingEdits=()=>false;const view=new MarkdownView();view.file=g.files.get('Library/a.md');view.editor={getValue:()=> 'unsaved'};g.app.workspace.getLeavesOfType=(type:string)=>type==='markdown'?[{view}]:[];await expect(g.d.turnOffKeep('Library/a.md')).rejects.toThrow('Unsaved');expect(g.writes).toEqual([]);
});
it('keeps protection on failed writes or changed metadata',async()=>{
    const f=await service();f.app.fileManager.processFrontMatter.mockRejectedValueOnce(Error('disk full'));await expect(f.d.turnOffKeep('Library/a.md')).rejects.toThrow('disk full');expect(f.data.get('Library/a.md')).toContain('keep: true');
    const g=await service();const process=g.app.fileManager.processFrontMatter.getMockImplementation()!;g.app.fileManager.processFrontMatter.mockImplementationOnce(async(file:any,cb:any)=>{g.data.set(file.path,note('keep: true')+'\nchanged');return process(file,(fm:any)=>{fm.keep=false;cb(fm);});});await expect(g.d.turnOffKeep('Library/a.md')).rejects.toThrow('changed');expect(g.data.get('Library/a.md')).toContain('keep: true');
});
it('uses new defaults for new installs and preserves legacy settings and Base lookup',async()=>{
    const f=fixture({'Old/Attachments Library.base':'views:\n - type: attachments-library-peng\n   name: All\n   alpOwned: attachments-library-peng:all\n'});
    for(const saved of [null,{}])expect((await settingsFromSaved(f.app,saved)).libraryFolder).toBe('Attachment Library');
    expect((await settingsFromSaved(f.app,{settingsVersion:2})).libraryFolder).toBe('Library');expect((await settingsFromSaved(f.app,{settingsVersion:2,libraryFolder:'Custom'})).libraryFolder).toBe('Custom');expect((await settingsFromSaved(f.app,{baseFolderPath:'Old'})).defaultBasePath).toBe('Old/Attachments Library.base');
    const p=new Plugin(f.app);p.loadData=vi.fn(async()=>null);await p.onload();await p.ready;await p.createGallery();expect(p.settings.defaultBasePath).toBe('Attachment Index.base');expect(f.files.has('Attachment Library')).toBe(false);
});
it('validates folder scope atomically and prevents automatic creation into a conflicting fresh default',async()=>{
    const f=fixture({'Attachment Library/existing.png':'x','outside.png':'x'});const p=new Plugin(f.app);p.loadData=vi.fn(async()=>null);p.saveData=vi.fn(async()=>{});await p.onload();await p.ready;
    f.events.create(f.files.get('outside.png'));await (p as any).eventQueue;expect(f.files.has('Attachment Library/outside.png.md')).toBe(false);
    await expect(p.setIndexScope('folder','Attachment Library')).rejects.toThrow('attachment folder');expect(p.settings.indexScope).toBe('vault');await p.setIndexFolder('Indexes');await p.setIndexScope('folder','Assets');expect(p.settings.attachmentsFolder).toBe('Assets');
    p.saveData=vi.fn(async()=>{throw Error('save failed')});await expect(p.setIndexScope('folder','Other')).rejects.toThrow('save failed');expect(p.settings.attachmentsFolder).toBe('Assets');
});
it('categorizes distinct blockers without exposing technical errors as the main message',async()=>{
    for(const [kind,modify,code] of [
        ['pending',(f:any)=>{f.d.hasPendingEdits=()=>true},'pending'],
        ['missing',(f:any)=>{f.files.delete('Library/a.md')},'missing-index'],
        ['scope',(f:any)=>{f.r.settings.indexScope='folder';f.r.settings.attachmentsFolder='Other'},'scope'],
        ['referenced',(f:any)=>{f.data.set('ref.md','[[Library/a.md]]');f.add('ref.md')},'index-used'],
    ] as const) {
        const f=await service('keep: false');modify(f);const plan=await f.d.prepare(['a.png'],kind==='referenced'?'metadata-only':'pair');expect(plan.skipped.length).toBeGreaterThan(0);expect(plan.reviews[0].blockCode).toBe(code);
    }
    const f=await service();await expect(f.d.turnOffKeep('Library/a.md','changed.png')).rejects.toThrow('conflicting');f.d.isActive=()=>false;await expect(f.d.turnOffKeep('Library/a.md')).rejects.toThrow('progress');
});
it('keeps folder drafts and scope on validation and persistence failures',async()=>{
    const f=fixture({'Assets/a.png':'x','Library/existing.png':'x'});const p=new Plugin(f.app);p.loadData=vi.fn(async()=>({settingsVersion:2,libraryFolder:'Library',indexScope:'vault'}));p.saveData=vi.fn(async()=>{});await p.onload();await p.ready;
    await expect(p.setIndexScope('folder','Library')).rejects.toThrow('attachment folder');expect(p.settings.indexScope).toBe('vault');
    await expect(p.setIndexScope('folder','Assets')).resolves.toBeUndefined();expect(p.settings.indexScope).toBe('folder');
    await expect(p.setIndexFolder('Assets')).rejects.toThrow('attachment folder');await p.setIndexFolder('Assets/Indexes');expect(p.settings.libraryFolder).toBe('Assets/Indexes');
    f.data.set('Assets/Indexes/b.png','x');f.add('Assets/Indexes/b.png');await expect(p.setIndexScope('vault')).rejects.toThrow('contains managed attachments');expect(p.settings.indexScope).toBe('folder');
    f.files.delete('Assets/Indexes/b.png');p.saveData=vi.fn(async()=>{throw Error('disk full')});await expect(p.setIndexScope('vault')).rejects.toThrow('disk full');expect(p.settings.indexScope).toBe('folder');
});
it('protects the Keep operation from stale associations, duplicate indexes, concurrent changes and dirty editor races',async()=>{
    const missing=await service();await expect(missing.d.turnOffKeep('missing.md')).rejects.toThrow('missing');
    const duplicate=await service();duplicate.data.set('Library/duplicate.md',note('keep: true'));duplicate.add('Library/duplicate.md');await expect(duplicate.d.turnOffKeep('Library/a.md')).rejects.toThrow('conflicting');
    const changed=await service('keep: false');await expect(changed.d.turnOffKeep('Library/a.md')).rejects.toThrow('changed');
    const stale=await service();const old=stale.app.fileManager.processFrontMatter.getMockImplementation()!;stale.app.fileManager.processFrontMatter.mockImplementationOnce(async(file:any,cb:any)=>{stale.add(file.path);return old(file,cb);});await expect(stale.d.turnOffKeep('Library/a.md')).rejects.toThrow('changed');
    const pending=await service();const original=pending.app.fileManager.processFrontMatter.getMockImplementation()!;pending.app.fileManager.processFrontMatter.mockImplementationOnce(async(file:any,cb:any)=>{pending.d.hasPendingEdits=()=>true;return original(file,cb);});await expect(pending.d.turnOffKeep('Library/a.md')).rejects.toThrow('changed');
    const dirty=await service();const view=new MarkdownView();view.file=dirty.files.get('Library/a.md');let text=dirty.data.get('Library/a.md')!;view.editor={getValue:()=>text};dirty.app.workspace.getLeavesOfType=(type:string)=>type==='markdown'?[{view}]:[];const edit=dirty.app.fileManager.processFrontMatter.getMockImplementation()!;dirty.app.fileManager.processFrontMatter.mockImplementationOnce(async(file:any,cb:any)=>{text+=' unsaved';return edit(file,cb);});await expect(dirty.d.turnOffKeep('Library/a.md')).rejects.toThrow('Save');
    const legacy=await service('al_keep: true');await legacy.d.turnOffKeep('Library/a.md');expect(legacy.data.get('Library/a.md')).toContain('al_keep: false');
});
it('protects other selected attachments while clearing only one Keep flag',async()=>{
    const f=await service();f.data.set('b.png','x');f.add('b.png');f.data.set('Library/b.md',note('keep: true').replaceAll('a.png','b.png'));f.add('Library/b.md');let plan=await f.d.prepare(['a.png','b.png'],'pair');expect(plan.skipped).toHaveLength(2);await f.d.turnOffKeep('Library/a.md','a.png');plan=await f.d.prepare(['a.png','b.png'],'pair');expect(plan.skipped).toHaveLength(1);expect(plan.reviews.find(r=>r.assetPath==='b.png')?.blockCode).toBe('keep');expect((await f.d.execute(plan)).status).toBe('aborted');expect(f.files.has('a.png')).toBe(true);expect(f.data.get('Library/b.md')).toContain('keep: true');
});
it('reports unsupported or incomplete sources without enabling deletion',async()=>{
    for(const [source,text] of [['bad.canvas','{'],['bad.md','[link](obsidian://unrecognized)']] as const){const f=await service('keep: false');f.data.set(source,text);f.add(source);const plan=await f.d.prepare(['a.png'],'pair');expect(plan.reviews[0].blockCode).toBe('references');expect(plan.targets).toHaveLength(0);}
});
it('keeps the delete dialog open and protection enabled when changing Keep fails',async()=>{
    const f=await service();const plan=await f.d.prepare(['a.png'],'pair');const pending=confirmDeletion(f.app,plan,()=>f.d.prepare(['a.png'],'pair'),async()=>{throw Error('Permission denied');});const modal=modalInstances.at(-1);const button=[...modal.contentEl.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Turn off Keep…')!;button.click();await vi.waitFor(()=>expect(modal.contentEl.textContent).toContain('Permission denied'));expect(f.data.get('Library/a.md')).toContain('keep: true');settingInstances.at(-1).buttonCallbacks[0]();expect(await pending).toBe(false);
});
it('prevents duplicate Keep actions while confirmation is pending',async()=>{
    const f=await service();const plan=await f.d.prepare(['a.png'],'pair');let release!:(value:boolean)=>void;vi.mocked(confirmAction).mockImplementationOnce(()=>new Promise(r=>release=r));const operation=vi.fn(async()=>{});const done=confirmDeletion(f.app,plan,()=>f.d.prepare(['a.png'],'pair'),operation);const modal=modalInstances.at(-1);const button=[...modal.contentEl.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Turn off Keep…')!;button.click();button.click();modal.close();expect(modal.contentEl.textContent).toContain('Keep');release(false);await vi.waitFor(()=>expect(button.disabled).toBe(false));expect(operation).not.toHaveBeenCalled();modal.close();expect(await done).toBe(false);
});
it('reports when the chosen index is no longer eligible or a transaction is active',async()=>{
    const f=await service();(f.d as any).busy=true;await expect(f.d.turnOffKeep('Library/a.md')).rejects.toThrow('progress');(f.d as any).busy=false;(f.d as any).preparing=true;await expect(f.d.turnOffKeep('Library/a.md')).rejects.toThrow('progress');(f.d as any).preparing=false;
    f.d.isActive=()=>false;await expect(f.d.turnOffKeep('Library/a.md')).rejects.toThrow('progress');
    const g=await service();const real=g.app.fileManager.processFrontMatter.getMockImplementation()!;g.app.fileManager.processFrontMatter.mockImplementationOnce(async(file:any,cb:any)=>{g.d.isActive=()=>false;return real(file,cb)});await expect(g.d.turnOffKeep('Library/a.md')).rejects.toThrow('changed');
});
it('rechecks a stale Keep operation and offers the index without an unlock callback',async()=>{
    const f=await service();const plan=await f.d.prepare(['a.png'],'pair');const pending=confirmDeletion(f.app,plan,undefined);const modal=modalInstances.at(-1);const button=[...modal.contentEl.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Turn off Keep…')!;expect(button.disabled).toBe(true);expect(modal.contentEl.textContent).toContain('Open index');modal.close();expect(await pending).toBe(false);
    const g=await service();const issued=await g.d.prepare(['a.png'],'pair');const done=confirmDeletion(g.app,issued,()=>g.d.prepare(['a.png'],'pair'),async()=>{throw 'failed';});const second=modalInstances.at(-1);[...second.contentEl.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Turn off Keep…')!.click();await vi.waitFor(()=>expect(second.contentEl.textContent).toContain('Could not change Keep'));second.close();expect(await done).toBe(false);
});
it('does not expose a Keep action for duplicate or malformed index protection',async()=>{
    for(const flags of ['keep: true\nal_keep: false','keep: nope']) { const f=await service(flags);const plan=await f.d.prepare(['a.png'],'pair');const done=confirmDeletion(f.app,plan,()=>f.d.prepare(['a.png'],'pair'),path=>f.d.turnOffKeep(path));const modal=modalInstances.at(-1);expect(modal.contentEl.textContent).toContain('invalid or disagree');expect(modal.contentEl.textContent).not.toContain('Turn off Keep…');modal.close();expect(await done).toBe(false); }
});
it('opens the protected index from the deletion explanation',async()=>{
    const f=await service();const plan=await f.d.prepare(['a.png'],'pair');const done=confirmDeletion(f.app,plan);const modal=modalInstances.at(-1);
    const link=[...modal.contentEl.querySelectorAll<HTMLAnchorElement>('a')].find(a=>a.textContent==='Open index')!;link.click();
    expect(f.app.workspace.openLinkText).toHaveBeenCalledWith('Library/a.md','',true,undefined);modal.close();expect(await done).toBe(false);
});
it('disables deletion on mobile and identifies unknown attachments without changing any files',async()=>{
    const {Platform}=await import('obsidian');const f=await service('keep: false');try{Platform.isDesktopApp=false;const plan=await f.d.prepare(['a.png','missing.png'],'pair');expect(plan.reviews[0].blockCode).toBe('desktop');expect(plan.skipped).toHaveLength(2);expect((await f.d.execute(plan)).status).toBe('aborted');expect(f.writes).toEqual([]);}finally{Platform.isDesktopApp=true;}
});
it('checks unrelated reference diagnostics and displays unknown blocked entries safely',async()=>{
    const f=await service('keep: false');f.data.set('Broken.canvas','broken');f.add('Broken.canvas');const plan=await f.d.prepare(['a.png','missing.png'],'pair');const done=confirmDeletion(f.app,plan);const modal=modalInstances.at(-1);expect(modal.contentEl.textContent).toContain('References could not be checked');expect(modal.contentEl.textContent).toContain('This item cannot be deleted yet');modal.close();expect(await done).toBe(false);
});
