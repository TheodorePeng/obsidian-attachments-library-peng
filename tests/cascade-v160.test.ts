import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkdownView, Platform, FileSystemAdapter } from 'obsidian';
import { fixture } from './fixture';
import { AttachmentRegistry, readDocument } from '../src/registry';
import { ReferenceService } from '../src/references';
import { DeletionService } from '../src/deletions';
import { DeletionRecovery, recoveryVault } from '../src/deletion-recovery';
import { DEFAULT_SETTINGS } from '../src/types';
import { planReferenceEdit, rewriteMarkdown, rewriteYaml, applyTextEdits } from '../src/reference-edits';
import { LibraryRestore } from '../src/library-restore';
import { OperationStore } from '../src/operation-store';
import { localTarget } from '../src/local-target';
import { analyzeBaseExpressions, baseFilterMatches } from '../src/base-formulas';
const index = '---\nal_schema: 1\n_filePath: assets/图.png\nattachment: "[[assets/图.png]]"\nal_keep: false\ncustom: preserve\n---\nOCR 🐧\n';
const canvas = JSON.stringify({ nodes: [{ id: 'photo', type: 'file', file: 'assets/图.png', x: 0 }, { id: 'other', type: 'text', text: 'unrelated' }], edges: [{ fromNode: 'photo', toNode: 'other' }] });
async function setup(extra: Record<string,string> = {}) {
    const f = fixture({ 'assets/图.png': 'binary', 'Library/图.png.md': index, ...extra });
    const registry = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS }); const refs = new ReferenceService(f.app, registry);
    const root = await mkdtemp(join(tmpdir(), 'alp-v160-')); const recovery = new DeletionRecovery(root);
    const d = new DeletionService(f.app, registry, refs, recovery);
    return { ...f, registry, refs, root, recovery, d, clean: () => rm(root, { recursive: true, force: true }) };
}
it('clears the reported Canvas and two embeds, trashes both targets, and restores exact originals', async()=>{
    const note = 'before 😀 ![[assets/图.png]] middle ![pic](assets/图.png) after';
    const f = await setup({ 'Untitled.canvas': canvas, 'preview.md': note });
    const callback = vi.fn(); f.refs.onRefreshed = callback;
    try {
        const p = await f.d.prepare(['assets/图.png'], 'pair'); expect(p.skipped).toEqual([]); expect(p.changes).toHaveLength(2); expect(f.writes).toEqual([]); expect(callback).not.toHaveBeenCalled();
        const result = await f.d.execute(p); expect(result.status).toBe('complete'); expect(f.data.get('preview.md')).toBe('before 😀  middle  after');
        expect(JSON.parse(f.data.get('Untitled.canvas')!)).toEqual({ nodes: [{ id: 'other', type: 'text', text: 'unrelated' }], edges: [] });
        expect(f.files.has('assets/图.png')).toBe(false); expect(f.files.has('Library/图.png.md')).toBe(false);
        const [journal] = await f.recovery.list(recoveryVault(f.app)); expect(journal.phase).toBe('complete');
        expect(await f.d.restoreJournal(journal)).toEqual([]); expect(f.data.get('assets/图.png')).toBe('binary'); expect(f.data.get('Library/图.png.md')).toBe(index); expect(f.data.get('Untitled.canvas')).toBe(canvas); expect(f.data.get('preview.md')).toBe(note);
    } finally { await f.clean(); }
});
it('requires a separate deletion after unlocking and restores the unlocked index and references',async()=>{
    const original=index.replace('al_keep: false','al_keep: true');const note='Before ![[assets/图.png]] after';
    const f=await setup({'Library/图.png.md':original,'Untitled.canvas':canvas,'preview.md':note});
    try {
        const blocked=await f.d.prepare(['assets/图.png'],'pair');expect(blocked.reviews[0].blockCode).toBe('keep');
        await f.d.turnOffKeep('Library/图.png.md','assets/图.png');expect(f.files.has('assets/图.png')).toBe(true);
        const unlocked=f.data.get('Library/图.png.md')!;expect(unlocked).toContain('al_keep: false');
        const plan=await f.d.prepare(['assets/图.png'],'pair');expect(plan.skipped).toEqual([]);expect((await f.d.execute(plan)).status).toBe('complete');
        const [journal]=await f.recovery.list(recoveryVault(f.app));expect(await f.d.restoreJournal(journal)).toEqual([]);
        expect(f.data.get('assets/图.png')).toBe('binary');expect(f.data.get('Library/图.png.md')).toBe(unlocked);expect(f.data.get('Untitled.canvas')).toBe(canvas);expect(f.data.get('preview.md')).toBe(note);
    } finally {await f.clean();}
});
it('merges multiple selected targets into a single source patch and refuses mixed protected selections',async()=>{
    const f=await setup({'b.png':'b','Library/b.md':index.replaceAll('assets/图.png','b.png'),'n.md':'![[assets/图.png]] ![[b.png]]'});
    try { const p=await f.d.prepare(['assets/图.png','b.png'],'pair'); expect(p.changes).toHaveLength(1); expect(p.changes[0].after).toBe(' '); f.data.set('Library/b.md',index.replaceAll('assets/图.png','b.png').replace('al_keep: false','al_keep: true')); const q=await f.d.prepare(['assets/图.png','b.png'],'pair'); expect(q.skipped.length).toBeGreaterThan(0); expect((await f.d.execute(q)).status).toBe('aborted'); expect(f.writes).toEqual([]); } finally { await f.clean(); }
});
it('rejects changed source, new references, binary edits and relevant dirty editors',async()=>{
    for(const variant of ['source','new','binary','dirty','canvas']) {
        const f=await setup({'n.md':'![[assets/图.png]]','c.canvas':canvas});
        try { const p=await f.d.prepare(['assets/图.png'],'pair');
            if(variant==='source')f.data.set('n.md','changed ![[assets/图.png]]');
            if(variant==='new'){f.data.set('new.md','[[assets/图.png]]');f.add('new.md');}
            if(variant==='binary')f.data.set('assets/图.png','edited');
            if(variant==='dirty'){const view=new MarkdownView();view.file=f.files.get('n.md');view.editor={getValue:()=> 'unsaved'};f.app.workspace.getLeavesOfType=(type:string)=>type==='markdown'?[{view}]:[];}
            if(variant==='canvas')f.app.workspace.getLeavesOfType=(type:string)=>type==='canvas'?[{view:{file:f.files.get('c.canvas')}}]:[];
            expect((await f.d.execute(p)).status,variant).toBe('aborted'); expect(f.app.vault.trash).not.toHaveBeenCalled();
        } finally {await f.clean();}
    }
});
it('backs out after edit/trash failures, but preserves subsequent user changes and occupied restore paths',async()=>{
    for(const variant of ['backup','edit','trash','later']) {
        const f=await setup({'n.md':'![[assets/图.png]]'});
        try {const p=await f.d.prepare(['assets/图.png'],'pair');
            if(variant==='backup')vi.spyOn(f.recovery,'begin').mockRejectedValue(Error('backup denied'));
            if(variant==='edit')f.app.vault.process.mockRejectedValueOnce(Error('write denied'));
            if(['trash','later'].includes(variant)){const trash=f.app.vault.trash.getMockImplementation()!;f.app.vault.trash.mockImplementation(async(file:any)=>{if(file.extension==='md'){if(variant==='later')f.data.set('n.md','user later text');throw Error('trash denied');}return trash(file);});}
            const result=await f.d.execute(p);
            expect(result.status).toBe(variant==='later'?'recovery-required':variant==='trash'?'rolled-back':'aborted');
            expect(f.data.get('assets/图.png')).toBe('binary');expect(f.data.get('Library/图.png.md')).toBe(index);expect(f.data.get('n.md')).toBe(variant==='later'?'user later text':'![[assets/图.png]]');
        }finally{await f.clean();}
    }
    const f=await setup();try{const p=await f.d.prepare(['assets/图.png'],'pair');await f.d.execute(p);const [j]=await f.recovery.list(recoveryVault(f.app));f.data.set('assets/图.png','occupied');f.add('assets/图.png');expect((await f.d.restoreJournal(j))[0]).toContain('occupied');expect(f.data.get('assets/图.png')).toBe('occupied');}finally{await f.clean();}
});
it('blocks mobile execution and safely edits a saved Canvas while ignoring unrelated unsaved notes',async()=>{
    const f=await setup({'c.canvas':canvas,'unrelated.md':'disk'});try{const view=new MarkdownView();view.file=f.files.get('unrelated.md');view.editor={getValue:()=> 'unsaved'};f.app.workspace.getLeavesOfType=(type:string)=>type==='markdown'?[{view}]:type==='canvas'?[{view:{file:f.files.get('c.canvas'),getViewData:()=>canvas}}]:[];expect((await f.d.prepare(['assets/图.png'],'pair')).skipped).toEqual([]);Platform.isDesktopApp=false;expect((await f.d.prepare(['assets/图.png'],'pair')).skipped[0].reason).toContain('desktop');expect(await f.recovery.list('x')).toEqual([]);await expect(f.recovery.begin('x',[])).rejects.toThrow('desktop');}finally{Platform.isDesktopApp=true;await f.clean();}
});
it('rewrites exact Markdown ranges with aliases, definitions, encoded links, HTML and protected syntax',()=>{
    const text='🐧 ![[图.png|80]] [caption](%E5%9B%BE.png) [[图.png]] [[图.png|别名]] ![pic][id]\n\n[id]: 图.png\n`![[图.png]]` $[[图.png]]$ <!-- [[图.png]] -->';
    const result=rewriteMarkdown(text,raw=>decodeURIComponent(raw)==='图.png');expect(result).toContain('🐧  caption 图.png 别名 ');expect(result).not.toContain('[id]:');expect(result).toContain('`![[图.png]]`');expect(result).toContain('<!-- [[图.png]] -->');
    expect(rewriteMarkdown('<img src="图.png"> <a href="图.png">label</a>',raw=>raw==='图.png')).toBe(' label');
    expect(()=>applyTextEdits('abc',[{from:0,to:2,value:''},{from:1,to:3,value:''}])).toThrow('Overlapping');
});
it('preserves duplicate YAML keys, comments, mixed text, block/flow sequences and unrelated values',()=>{
    const text='a: "[[图.png]]"\ncustom: first\ncustom: second\nlist:\n - "[[图.png]]"\n - other\nflow: ["[[图.png]]", keep]\nlast: [keep, "[[图.png]]"]\nsolo: ["[[图.png]]"]\nmix: "before [[图.png|label]] after" # keep comment\n';
    const after=rewriteYaml(text,raw=>raw==='图.png');expect(after).toContain('custom: first\ncustom: second');expect(after).toContain('a: ""');expect(after).toContain('before label after');expect(after).toContain('# keep comment');expect(readDocument('---\n'+after+'---\n').metadata.list).toEqual(['other']);
    const f=fixture({'图.png':'x'});const targets=new Set(['图.png']);const value=planReferenceEdit(f.app,'c.canvas',JSON.stringify({nodes:[{id:'t',type:'text',text:'![[图.png]]'},{id:'g',type:'group',background:'图.png'},{id:'l',type:'link',url:'obsidian://open?file=%E5%9B%BE.png'}],edges:[{fromNode:'t',toNode:'g'}]}),targets);expect(JSON.parse(value.after)).toEqual({nodes:[{id:'g',type:'group'}],edges:[]});
    expect(planReferenceEdit(f.app,'f.base','formulas:\n  image: \'image("图.png")\'\n',targets).after).not.toContain('image("图.png")');expect(()=>planReferenceEdit(f.app,'n.md','plain mention 图.png',targets)).toThrow('safely');
});
it('restores portable identity after reinstall, protects unadopted candidates, and never changes OCR or custom fields',async()=>{
    const legacy=index.replace('al_schema: 1\n',''),f=fixture({'assets/图.png':'x','Old/图.md':legacy,'Any name.base':'views:\n - type: attachments-library-peng\n   name: Mine\n'});const registry=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});const store=new OperationStore(await mkdtemp(join(tmpdir(),'alp-adopt-')));const service=new LibraryRestore(f.app,registry,store);
    const result=await service.discover();expect(result.bases).toEqual(['Any name.base']);expect(result.candidates).toHaveLength(1);expect(registry.records.get('assets/图.png')?.conflict).toBe(true);await registry.refresh();await registry.refresh(true);expect(registry.records.get('assets/图.png')?.conflict).toBe(true);expect(f.writes).toEqual([]);await service.adopt(result.candidates);expect(f.data.get('Old/图.md')).toBe(index);const reinstalled=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});await reinstalled.refresh();expect(reinstalled.records.get('assets/图.png')?.conflict).toBe(false);expect(reinstalled.byIndex.has('Old/图.md')).toBe(true);f.data.set('Old/图.md',legacy+'later');await expect(service.adopt(result.candidates)).rejects.toThrow('changed');
});
it('classifies local URLs without suppressing uncertain actions, parses actual Base formulas and bounds filters',async()=>{
    const f=fixture({});f.app.vault.getName=()=> 'Test';
    expect(localTarget(f.app,'obsidian://adv-uri?vault=Test&settingid=editor').ignore).toBe(true);expect(localTarget(f.app,'obsidian://show-plugin?id=x').ignore).toBe(true);expect(localTarget(f.app,'obsidian://open?file=A.md').path).toBe('A.md');expect(localTarget(f.app,'obsidian://adv-uri?settingid=x&filepath=A.md').path).toBe('A.md');expect(localTarget(f.app,'obsidian://adv-uri?settingid=x&unknown=x').unknown).toBe(true);expect(localTarget(f.app,'obsidian://open?vault=Other&file=A.md').ignore).toBe(true);expect(localTarget(f.app,'file:///outside/a.png').unknown).toBe(true);
    f.app.vault.adapter=new FileSystemAdapter('/vault');expect(localTarget(f.app,'file:///vault/A.png').path).toBe('A.png');expect(localTarget(f.app,'file:///elsewhere/A.png').ignore).toBe(true);expect(localTarget(f.app,'file://server/a.png').unknown).toBe(true);
    const formulas={Plugin:'link(file.path, name)',Settings:'link("obsidian://adv-uri?settingid=" + if(status == "enabled" && ["x"].contains(plugin_id), plugin_id, if(type == "core", "core-plugins", "community-plugins")), "Settings")'};
    const result=analyzeBaseExpressions(formulas,[{path:'A.md',properties:{name:'A',status:'enabled',plugin_id:'x'}}]);expect(result.issues).toEqual([]);expect(result.links.map(link=>link.target)).toEqual(['A.md','obsidian://adv-uri?settingid=x']);
    for(const [filter,expected] of [['file.ext == "md"',true],['file.inFolder("F")',false],['!false || false',true],['1 >= 2',false],['unknownCall()',undefined]])expect(baseFilterMatches(filter,{path:'A.md',properties:{}})).toBe(expected);
    expect(baseFilterMatches({and:['true','false']},{path:'A.md',properties:{}})).toBe(false);expect(baseFilterMatches({or:['false','bad()']},{path:'A.md',properties:{}})).toBeUndefined();
});
it('unrelated settings URIs, placeholders and duplicate keys no longer block the reported attachment',async()=>{
    const f=await setup({'unrelated.md':'---\ncustom: first\ncustom: second\n---\n[Settings](obsidian://adv-uri?settingid=editor)\n<video title>\n<video url>','plugins.base':'formulas:\n  Plugin: link(file.path, name)\n  Settings: \'link("obsidian://adv-uri?settingid=" + if(status == "enabled" && ["x"].contains(plugin_id), plugin_id, "community-plugins"), "Settings")\'\n'});
    try{const p=await f.d.prepare(['assets/图.png'],'pair');expect(p.skipped).toEqual([]);expect(p.changes).toEqual([]);}finally{await f.clean();}
});
it('detects interrupted, unreadable and corrupt recovery records and refuses unsafe restoration',async()=>{
    const f=await setup();try{
        const journal=await f.recovery.begin(recoveryVault(f.app),[{path:'gone.png',before:Buffer.from('original').toString('base64'),binary:true},{path:'n.md',before:'before',after:'after',binary:false}]);
        await f.recovery.phase(journal,'editing');expect((await f.recovery.list(recoveryVault(f.app)))[0].phase).toBe('editing');expect(await f.recovery.list('Other Vault')).toEqual([]);
        const file=join(f.root,journal.id,'transaction.json');await writeFile(file,'bad JSON');expect(await f.recovery.list(recoveryVault(f.app))).toEqual([]);expect(f.recovery.issues[0]).toContain('Unreadable');
        await expect(f.recovery.restore(f.app,{...journal,vault:'wrong'})).rejects.toThrow('different');await expect(f.recovery.restore(f.app,{...journal,files:[{...journal.files[0],path:'../bad'}]})).rejects.toThrow();await expect(f.recovery.restore(f.app,{...journal,files:[{...journal.files[0],before:'corrupted'}]})).rejects.toThrow('integrity');
        const conflicts=await f.recovery.restore(f.app,journal);expect(conflicts[0]).toContain('Source missing');expect(f.data.get('gone.png')).toBe('original');
        f.data.set('n.md','after');f.add('n.md');expect(await f.recovery.restore(f.app,journal)).toEqual([]);expect(f.data.get('n.md')).toBe('before');expect(await f.recovery.restore(f.app,journal)).toEqual([]);
    }finally{await f.clean();}
});
it('legacy discovery rejects disagreements, missing files, duplicates and stale/pending adoption',async()=>{
    const f=await setup({'A.base':'views: [','legacy.md':index.replace('al_schema: 1\n',''),'bad.md':'---\n_filePath: other.png\nattachment: "[[assets/图.png]]"\n---\n','missing.md':'---\n_filePath: absent.png\nattachment: "[[absent.png]]"\n---\n','plain.md':'normal text'});try{
        const service=new LibraryRestore(f.app,f.registry,new OperationStore(f.root));let result=await service.discover();expect(result.conflicts.some(item=>item.includes('Invalid Base'))).toBe(true);expect(result.candidates.filter(item=>item.error).length).toBe(3);
        await expect(service.adopt(result.candidates)).rejects.toThrow('conflicted');service.isActive=()=>false;await expect(service.adopt([])).rejects.toThrow('stopped');service.isActive=()=>true;await service.adopt([]);
        f.files.delete('Library/图.png.md');f.files.delete('bad.md');f.files.delete('missing.md');result=await service.discover();service.blocked=()=>true;await expect(service.adopt(result.candidates)).rejects.toThrow('pending');service.blocked=()=>false;
        const before=f.app.vault.process.getMockImplementation()!;f.app.vault.process.mockImplementationOnce(async(file:any,callback:any)=>{f.data.set(file.path,index+'changed');return before(file,callback);});await expect(service.adopt(result.candidates)).rejects.toThrow('changed');
    }finally{await f.clean();}
});
it('covers conservative expression and YAML editing boundaries without invoking arbitrary code',()=>{
    const row={path:'Folder/a.md',properties:{enabled:false}};
    for(const filter of [undefined,{and:['true','unsupported()']},{or:['false','true']},{not:['false']},{not:['unsupported()']},{unexpected:[]},1,'null > 1','false && unsupported()','1 < 2','2 <= 2','file.name == "a.md"','file.unsupported == 1'])baseFilterMatches(filter,row);
    expect(rewriteYaml('flow: ["[[a]]", "[[a]]"]\nbody: |\n  before [[a|label]] after\nnext: keep\n',x=>x==='a')).toBe('flow: []\nbody: "before label after\\n"\nnext: keep\n');
    expect(()=>rewriteYaml('bad: [',()=>false)).toThrow('Invalid YAML');expect(()=>readDocument('---\nal_schema: 1\nal_schema: 2\n---\n')).toThrow('Duplicate managed');
    const f=fixture({});expect(()=>planReferenceEdit(f.app,'a.canvas','{}',new Set())).toThrow('Invalid Canvas');expect(localTarget(f.app,'file://%invalid').unknown).toBe(true);
});
it('edits direct Base provenance properties while preserving formulas, static query identity and duplicate literal refs',async()=>{
    const f=await setup({'row.md':'---\nTarget: assets/图.png\nlabel: preserve\n---\nUser text','lookup.base':'formulas:\n  Cover: image(note.Target)\n'});try{
        const p=await f.d.prepare(['assets/图.png'],'pair');expect(p.skipped).toEqual([]);expect(p.changes.map(item=>item.path)).toEqual(['row.md']);expect(p.changes[0].after).toContain('Target: ""');expect(p.changes[0].after).toContain('User text');expect((await f.d.execute(p)).status).toBe('complete');expect(f.data.get('lookup.base')).toContain('image(note.Target)');
    }finally{await f.clean();}
    const g=await setup({'literal.base':'formulas:\n  Link: link("Library/图.png.md")\n'});try{expect((await g.d.prepare(['assets/图.png'],'pair')).changes[0].path).toBe('literal.base');}finally{await g.clean();}
});
it('keeps URI-encoded percent names exact and retains genuinely unknown URI and dynamic Base blockers',async()=>{
    const f=fixture({'%20.png':'x','Library/x.md':'---\nal_schema: 1\n_filePath: "%20.png"\nattachment: "[[%20.png]]"\n---\n','n.md':'[file](obsidian://open?file=%2520.png)'});f.app.vault.getName=()=> 'Vault';const registry=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});await registry.refresh();const refs=new ReferenceService(f.app,registry,true);await refs.refresh(undefined,false);expect(refs.getUsage(registry.records.get('%20.png')!).count).toBe(1);expect(planReferenceEdit(f.app,'n.md',f.data.get('n.md')!,new Set(['%20.png'])).after).toBe('file');expect(localTarget(f.app,'obsidian://open?vault=0123456789abcdef&file=a.png').unknown).toBe(true);
    const g=await setup({'n.md':'[unknown](obsidian://adv-uri?settingid=x&unknown=anything)'});try{expect((await g.d.prepare(['assets/图.png'],'pair')).skipped[0].reason).toContain('incomplete');}finally{await g.clean();}
});
it('blocks mixed editable/dynamic references in preview without touching sources',async()=>{
    const f=await setup({'row.md':'---\nPrefix: assets/图\n---\n![[assets/图.png]]','query.base':'formulas:\n  Picture: image(note.Prefix + ".png")\n'});try{
        const p=await f.d.prepare(['assets/图.png'],'pair');expect(p.skipped.length).toBeGreaterThan(0);expect((await f.d.execute(p)).status).toBe('aborted');expect(f.writes).toEqual([]);
    }finally{await f.clean();}
});
it('rejects custom configuration directories and out-of-Vault absolute paths',async()=>{
    const {inputVaultPath}=await import('../src/paths');const f=fixture({});f.app.vault.configDir='Config';expect(()=>inputVaultPath(f.app,'Config/notes')).toThrow('configuration');expect(()=>inputVaultPath(f.app,'/vault/x')).toThrow('relative');Object.setPrototypeOf(f.app.vault.adapter,FileSystemAdapter.prototype);f.app.vault.adapter.getBasePath=()=>'/vault';expect(inputVaultPath(f.app,'/vault/中文 space')).toBe('中文 space');expect(()=>inputVaultPath(f.app,'/outside/x')).toThrow('inside');
});
it('revalidates identities, protection and scope before trash and keeps fresh preview memory bounded',async()=>{
    const f=await setup();try{const p=await f.d.prepare(['assets/图.png'],'pair');f.add('assets/图.png');expect((await f.d.execute(p)).message).toContain('identity');for(let i=0;i<22;i++)await f.d.prepare(['assets/图.png'],'pair');expect((f.d as any).issued.size).toBe(20);}finally{await f.clean();}
    const g=await setup({'n.md':'![[assets/图.png]]'});try{const p=await g.d.prepare(['assets/图.png'],'pair');const process=g.app.vault.process.getMockImplementation()!;g.app.vault.process.mockImplementationOnce(async(file:any,fn:any)=>{const result=await process(file,fn);g.data.set('Library/图.png.md',index.replace('al_keep: false','al_keep: true'));return result;});expect((await g.d.execute(p)).status).toBe('recovery-required');expect(g.app.vault.trash).not.toHaveBeenCalled();}finally{await g.clean();}
});
it('keeps future schema and damaged managed identity protected across fresh inventory scans',async()=>{
    const f=fixture({'a.png':'x','b.png':'x','Future.md':'---\nal_schema: 3\nattachment: "[[a.png]]"\n---\n','Broken.md':'---\nal_schema: 1\n_filePath: b.png\nattachment: bad\n---\n','Unknown.md':'---\nal_schema: 3\nattachment: bad\n---\n'});const r=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});await r.refresh();expect(r.records.get('a.png')?.conflict).toBe(true);expect(r.records.get('b.png')?.reason).toContain('Invalid attachment');expect(r.mappingComplete).toBe(false);
});
it('scans duplicate YAML values in index notes and does not discard duplicate Base definitions or filter rows',async()=>{
    const b=index.replaceAll('assets/图.png','b.png').replace('custom: preserve','custom: "[[assets/图.png]]"\ncustom: second');const f=await setup({'b.png':'b','Library/b.md':b});try{const p=await f.d.prepare(['assets/图.png'],'pair');expect(p.skipped).toEqual([]);expect(p.changes[0].path).toBe('Library/b.md');expect(p.changes[0].after).toContain('custom: ""\ncustom: second');}finally{await f.clean();}
    const g=await setup({'row.md':'---\nTarget: assets/图.png\n---\n','lookup.base':'filters: file.inFolder("row")\nfilters: file.inFolder("none")\nformulas:\n  Cover: image(note.Target)\n'});try{expect((await g.d.prepare(['assets/图.png'],'pair')).changes[0].path).toBe('row.md');}finally{await g.clean();}
    const h=await setup({'dup.base':'formulas:\n  Cover: image("assets/图.png")\n  Cover: image("elsewhere.png")\n'});try{const p=await h.d.prepare(['assets/图.png'],'pair');expect(p.skipped[0].reason).toContain('incomplete');expect(p.reviews[0].usage?.occurrences.some(item=>item.sourcePath==='dup.base')).toBe(true);}finally{await h.clean();}
});
it('finds linked images and bare local URIs, preserving unrelated nested image content when unlinking',()=>{
    const text='Before [![picture](a.png)](index.md) after';
    expect(rewriteMarkdown(text,target=>target==='a.png')).toBe('Before [](index.md) after');
    expect(rewriteMarkdown(text,target=>target==='index.md')).toBe('Before ![picture](a.png) after');
    expect(rewriteMarkdown(text,target=>['a.png','index.md'].includes(target))).toBe('Before  after');
    const f=fixture({'a.png':'x'});f.app.vault.getName=()=> 'Test';const targets=new Set(['a.png']);
    expect(planReferenceEdit(f.app,'n.md','Use (obsidian://open?file=a.png).',targets).after).toBe('Use (`obsidian://open?file=a.png`).');
    expect(planReferenceEdit(f.app,'n.md','[obsidian://open?file=a.png](obsidian://open?file=a.png)',targets).after).toBe('`obsidian://open?file=a.png`');
    expect(rewriteMarkdown('`obsidian://open?file=a.png` <!-- file:///a.png -->',()=>true)).toBe('`obsidian://open?file=a.png` <!-- file:///a.png -->');
});
it('preserves empty-link filenames and nested/escaped labels and neutralizes local autolinks',()=>{
    expect(rewriteMarkdown('[](Folder/a.png)',()=>true)).toBe('a.png');
    expect(rewriteMarkdown('[nested [bracket]](a.png)',()=>true)).toBe('nested [bracket]');
    expect(rewriteMarkdown('[escaped \\[bracket\\]](a.png)',()=>true)).toBe('escaped \\[bracket\\]');
    expect(rewriteMarkdown('<obsidian://open?file=a.png>',()=>true)).toBe('`obsidian://open?file=a.png`');
    expect(rewriteMarkdown('obsidian://open?file=a(1)',()=>true)).toBe('`obsidian://open?file=a(1)`');
    expect(rewriteMarkdown('[![A](a.png) ![B](b.png)](index.md)',target=>target!=='b.png')).toBe(' ![B](b.png)');
});
