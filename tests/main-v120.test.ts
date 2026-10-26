// @vitest-environment happy-dom
import { it, expect, vi } from 'vitest';
import Plugin from '../src/main';
import { fixture } from './fixture';
import { noticeMessages } from 'obsidian';
import { confirmAction } from '../src/dialogs';
vi.mock('../src/dialogs', () => ({ confirmAction: vi.fn(async () => false) }));
vi.mock('../src/i18n/i18n', () => ({ initI18n: vi.fn(async () => {}), t: (key: string) => key }));
async function setup(contents: Record<string,string> = {}) {
  const f=fixture(contents); const p=new Plugin(f.app); await p.onload(); await p.ready; return {...f,p};
}
const oldBase='filters: file.inFolder("Library")\nviews:\n - type: cards\n   name: Cards\n - type: attachments-library-peng\n   name: All attachments\n   alpOwned: attachments-library-peng:all\n';
it('opens the selected gallery without changing configuration',async()=>{const f=await setup({'Attachments Library.base':oldBase});await f.p.openLibrary();expect(f.data.get('Attachments Library.base')).toBe(oldBase);expect(f.writes).toEqual([]);expect(f.app.workspace.getLeaf.mock.results.at(-1).value.setViewState).toHaveBeenCalledWith({type:'bases',state:{file:'Attachments Library.base',viewName:'All attachments'}});});
it('requires explicit repair and protects stale approval',async()=>{const f=await setup({'Attachments Library.base':'views: []'});f.p.store.save=vi.fn(async()=> 'private-backup');await expect(f.p.openLibrary()).rejects.toThrow('missing');vi.mocked(confirmAction).mockResolvedValueOnce(false);await f.p.reviewLibraryConfiguration();expect(f.writes).toEqual([]);vi.mocked(confirmAction).mockImplementationOnce(async()=>{f.data.set('Attachments Library.base','views: []\n# changed');return true;});await expect(f.p.reviewLibraryConfiguration()).rejects.toThrow('changed');expect(f.writes).toEqual([]);vi.mocked(confirmAction).mockResolvedValueOnce(true);await f.p.reviewLibraryConfiguration();expect(f.data.get('Attachments Library.base')).toContain('alpOwned');expect(f.p.store.save).toHaveBeenCalled();await f.p.reviewLibraryConfiguration();expect(noticeMessages.at(-1)).toContain('no repair');const g=await setup();await expect(g.p.openLibrary()).rejects.toThrow('Choose');await expect(g.p.reviewLibraryConfiguration()).rejects.toThrow('Choose');});
it('an unrelated source change does not abort an already safe deletion snapshot',async()=>{
  const f=await setup({'a.png':'image','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\nOCR','note.md':'old'});const plan=await f.p.deletions.prepare(['a.png'],'pair');f.data.set('note.md','new plain text');expect((await f.p.deletions.execute(plan)).status).toBe('complete');
});
it('rechecks the index fingerprint after the asset step and reports an intervening edit',async()=>{
  const f=await setup({'a.png':'image','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\nOCR'});const plan=await f.p.deletions.prepare(['a.png'],'pair');const trash=f.app.vault.trash.getMockImplementation()!;f.app.vault.trash.mockImplementation(async(file:any)=>{await trash(file);if(file.path==='a.png') f.data.set('Library/a.md',f.data.get('Library/a.md')+'\nnew OCR');});const result=await f.p.deletions.execute(plan);expect(result.status).toBe('partial');expect(result.steps.map(s=>s.status)).toEqual(['trashed','failed']);expect(f.files.has('Library/a.md')).toBe(true);
});

it("unloads native-owned gallery components when the plugin stops", async () => { const f=await setup(); const view={unload:vi.fn(()=>f.p.galleryViews.delete(view as any))}; f.p.galleryViews.add(view as any); for (const stop of f.p.disposers) stop(); expect(view.unload).toHaveBeenCalledTimes(1); expect(f.p.galleryViews.size).toBe(0); });
