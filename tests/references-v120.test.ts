import { it, expect } from 'vitest';
import { AttachmentRegistry } from '../src/registry';
import { ReferenceService } from '../src/references';
import { DeletionService } from '../src/deletions';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
async function setup(extra: Record<string,string> = {}) {
    const f = fixture({'a.png':'binary','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n<!-- alp:preview:start -->\n![[a.png]]\n<!-- alp:preview:end -->\n## OCR\n', ...extra});
    const registry = new AttachmentRegistry(f.app, {...DEFAULT_SETTINGS}); await registry.refresh();
    const refs = new ReferenceService(f.app, registry); await refs.refresh();
    return {...f, registry, refs, deletions:new DeletionService(f.app,registry,refs)};
}
it('does not treat actual mathematics and code examples as business references', async()=>{
    const f=await setup({'math.md':'$[1-F(x)][1-F(y)]$ `[[a.png]]`\n\n```\n[[a.png]]\n```\n<!-- [[a.png]] -->'});
    const u=f.refs.getUsage(f.registry.records.get('a.png')!);expect(u.state).toBe('orphan');expect(u.assetCheckComplete).toBe(true);expect(u.count).toBe(0);
});
it('proves TSNotes links external and refreshes Base targets when a row property changes', async()=>{
    const f=await setup({'row.md':'---\nURL-TSNotes: https://example.com/video\n---\n','videos.base':'formulas:\n  Play: \'if(note["URL-TSNotes"], link(note["URL-TSNotes"], icon("play")), "")\'\nviews: [{type:table}]'});
    expect(f.refs.getUsage(f.registry.records.get('a.png')!).state).toBe('orphan');
    f.data.set('row.md','---\nURL-TSNotes: a.png\n---\n');await f.refs.refresh(['row.md']);
    const u=f.refs.getUsage(f.registry.records.get('a.png')!);expect(u.sources).toContain('videos.base');expect(u.occurrences.some(o=>o.formula==='Play')).toBe(true);
});
it('keeps definite usage used while separately showing incomplete checks',async()=>{
    const f=await setup({'note.md':'[[a.png]]','unknown.base':'formulas:\n  target: link(unsupported())'});const u=f.refs.getUsage(f.registry.records.get('a.png')!);
    expect(u.state).toBe('used');expect(u.assetCheckComplete).toBe(false);expect((await f.deletions.prepare(['a.png'],'pair')).reviews[0].blockedReason).toBeTruthy();
});
it('limits unresolved candidate issues and allows metadata-only when only the binary check is incomplete',async()=>{
    const f=await setup({'b.png':'x','Library/b.md':'---\n_filePath: b.png\nattachment: "[[b.png]]"\n---\n','note.md':'[[A.png]]'});
    const resolve=f.app.metadataCache.getFirstLinkpathDest;f.app.metadataCache.getFirstLinkpathDest=(p:string,s:string)=>p==='A.png'?null:resolve(p,s);await f.refs.refresh();
    expect(f.refs.getUsage(f.registry.records.get('b.png')!).state).toBe('orphan');
    const usage=f.refs.getUsage(f.registry.records.get('a.png')!);expect(usage.assetCheckComplete).toBe(false);expect(usage.indexCheckComplete).toBe(true);
    expect((await f.deletions.prepare(['a.png'],'metadata-only')).targets).toHaveLength(1);expect((await f.deletions.prepare(['a.png'],'pair')).targets).toHaveLength(0);
});
it('shows all candidate indexes in protected previews and does not throw when every item is protected',async()=>{
    const f=await setup({'Library/duplicate.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n'});const p=await f.deletions.prepare(['a.png'],'pair');
    expect(p.reviews[0].indexPaths).toHaveLength(2);expect(p.targets).toHaveLength(0);expect((await f.deletions.execute(p)).status).toBe('aborted');expect(f.writes).toHaveLength(0);
});
it('does not reject confirmed deletion after an unrelated source changes',async()=>{
    const f=await setup({'unrelated.md':'before'});const p=await f.deletions.prepare(['a.png'],'pair');f.data.set('unrelated.md','after without any link');
    expect((await f.deletions.execute(p)).status).toBe('complete');
});
it('records source positions and preserves index inbound protection',async()=>{
    const f=await setup({'n.md':'# Title\n\n[[Library/a.md]]'});const u=f.refs.getUsage(f.registry.records.get('a.png')!);
    expect(u.indexSources).toEqual(['n.md']);expect(u.occurrences[0].line).toBe(3);expect(u.excluded.some(e=>e.property==='attachment')).toBe(true);
});
