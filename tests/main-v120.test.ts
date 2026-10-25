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
it('opens the owned view by marker while preserving names and original config',async()=>{
  const f=await setup({'Attachments Library.base':oldBase}); await f.p.openLibrary();
  expect(f.app.workspace.getLeaf.mock.results.at(-1)!.value.setViewState).toHaveBeenCalledWith({type:'bases',state:{file:'Attachments Library.base',viewName:'All attachments'}});expect(f.writes).toEqual([]);
});
it('requires consent for a Base without managed views, then appends without replacing native views',async()=>{
  const f=await setup({'Attachments Library.base':'views:\n - type: table\n   name: Mine\n'});
  vi.mocked(confirmAction).mockResolvedValueOnce(false);await f.p.openLibrary();expect(f.writes).toEqual([]);
  vi.mocked(confirmAction).mockResolvedValueOnce(true);await f.p.openLibrary();expect(f.data.get('Attachments Library.base')).toContain('Mine');expect(f.files.has('Attachments Library.base.alp-backup')).toBe(true);
});
it('configuration review preserves referenced names, supports cancel, and backs up confirmed changes',async()=>{
  const f=await setup({'Attachments Library.base':oldBase,'note.md':'![[Attachments Library.base#All attachments]]\n[Table](Attachments%20Library.base#All%20attachments)'});
  vi.mocked(confirmAction).mockResolvedValueOnce(false);await f.p.reviewLibraryConfiguration();expect(f.writes).toEqual([]);
  vi.mocked(confirmAction).mockResolvedValueOnce(true);await f.p.reviewLibraryConfiguration();expect(f.data.get('Attachments Library.base')).toContain('All attachments');expect(f.data.get('Attachments Library.base')).toContain('al_schema == 1');
  await f.p.reviewLibraryConfiguration();expect(noticeMessages.at(-1)).toContain('无需调整');
});
it('refuses stale configuration approval and creates an absent library through the normal path',async()=>{
  const f=await setup({'Attachments Library.base':oldBase});vi.mocked(confirmAction).mockImplementationOnce(async()=>{f.data.set('Attachments Library.base','views: []');return true;});await f.p.reviewLibraryConfiguration();expect(f.writes).toEqual([]);expect(noticeMessages.at(-1)).toContain('已变化');
  const g=await setup();await g.p.reviewLibraryConfiguration();expect(g.files.has('Attachments Library.base')).toBe(true);
});
it('handles unreadable view references conservatively and picks an unused backup name',async()=>{
  const f=await setup({'Attachments Library.base':oldBase,'Attachments Library.base.alp-backup':'older','note.md':'text'});const read=f.app.vault.cachedRead;f.app.vault.cachedRead=async(file:any)=>{if(file.path==='note.md')throw Error('read denied');return read(file);};vi.mocked(confirmAction).mockResolvedValueOnce(true);await f.p.reviewLibraryConfiguration();expect(f.data.get('Attachments Library.base')).toContain('All attachments');expect(f.files.has('Attachments Library.base.alp-backup-1')).toBe(true);
});
it('an unrelated source change does not abort an already safe deletion snapshot',async()=>{
  const f=await setup({'a.png':'image','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\nOCR','note.md':'old'});const plan=await f.p.deletions.prepare(['a.png'],'pair');f.data.set('note.md','new plain text');expect((await f.p.deletions.execute(plan)).status).toBe('complete');
});
it('rechecks the index fingerprint after the asset step and reports an intervening edit',async()=>{
  const f=await setup({'a.png':'image','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\nOCR'});const plan=await f.p.deletions.prepare(['a.png'],'pair');const trash=f.app.vault.trash.getMockImplementation()!;f.app.vault.trash.mockImplementation(async(file:any)=>{await trash(file);if(file.path==='a.png') f.data.set('Library/a.md',f.data.get('Library/a.md')+'\nnew OCR');});const result=await f.p.deletions.execute(plan);expect(result.status).toBe('partial');expect(result.steps.map(s=>s.status)).toEqual(['trashed','failed']);expect(f.files.has('Library/a.md')).toBe(true);
});
