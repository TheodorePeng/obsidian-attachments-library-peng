import { describe, expect, it } from 'vitest';
import { AttachmentRegistry } from '../src/registry';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
describe('registry', () => {
    it('adopts matching legacy metadata read-only without changing Chinese body', async () => {
        const f = fixture({ 'a/图.png': 'image', 'Library/图.png.md': '---\n_filePath: a/图.png\nattachment: "[[a/图.png]]"\ntags: [数学]\n---\nOCR $x$' });
        const r = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS });
        await r.refresh();
        expect(r.records.get('a/图.png')?.indexPath).toBe('Library/图.png.md');
        expect(f.writes).toHaveLength(0);
    });
    it('rejects conflicting links and duplicate mappings', async () => {
        const f = fixture({ 'a.png': 'x', 'b.png': 'x', 'Library/a.md': '---\n_filePath: a.png\nattachment: "[[b.png]]"\n---\n', 'Library/b.md': '---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n' });
        const r = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS });
        await r.refresh();
        expect(r.records.get('a.png')?.conflict).toBe(true);
        expect(r.records.get('b.png')?.conflict).toBe(true);
    });
});
it('excludes foreign legacy metadata and permits managed indexes moved outside Library', async () => { const f = fixture({ 'a.png': 'x', 'foreign.md': '---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n', 'moved.md': '---\nal_schema: 1\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n' }); const r = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS }); await r.refresh(); expect(r.byIndex.has('foreign.md')).toBe(false); expect(r.records.get('a.png')?.indexPath).toBe('moved.md'); });
it('protects asset and index casefold collisions, missing and excluded state', async () => { const f = fixture({ 'A.png': 'x', 'a.png': 'x', 'Library/I.md': '---\n_filePath: A.png\nattachment: "[[A.png]]"\n---\n', 'Library/i.md': 'text', 'Library/missing.md': '---\n_filePath: gone.png\nattachment: "[[gone.png]]"\n---\n', 'elsewhere.jpg': 'x', 'Library/out.md': '---\n_filePath: elsewhere.jpg\nattachment: "[[elsewhere.jpg]]"\n---\n' }); const r = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS, indexScope: 'folder', attachmentsFolder: 'Files' }); await r.refresh(); expect(r.state(r.records.get('A.png')!)).toBe('conflict'); expect(r.state(r.records.get('gone.png')!)).toBe('missing'); expect(r.state(r.records.get('elsewhere.jpg')!)).toBe('excluded'); });
it('ignores malformed or incomplete metadata, preserves stable generation and index moves', async () => { const f = fixture({ 'a.png': 'x', 'Library/invalid.md': '---\nxx: [\n---\n', 'Library/list.md': '---\n[one, two]\n---\n', 'Library/no.md': '---\n_filePath: a.png\n---\n', 'Library/empty.md': '---\n_filePath: ""\nattachment: "[[a.png]]"\n---\n', 'Library/a.md': '---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n' }); const r = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS }); await r.refresh(); const generation = r.generation; await r.refresh(); expect(r.generation).toBe(generation); const index = f.files.get('Library/a.md')!; const text = f.data.get(index.path)!; f.files.delete(index.path); f.data.delete(index.path); index.path = 'Library/moved.md'; f.files.set(index.path, index); f.data.set(index.path, text); await r.refresh(); expect(r.records.get('a.png')?.indexPath).toBe('Library/moved.md'); expect(r.state(r.records.get('a.png')!)).toBe(null); });
it('retains a missing binary when native resolution falls back to its same-named Markdown index', async () => {
    const f = fixture({ 'Library/Folder/sample.pdf.md': '---\n_filePath: Folder/sample.pdf\nattachment: "[[Folder/sample.pdf]]"\n---\nOCR retained' });
    f.app.metadataCache.getFirstLinkpathDest = () => f.files.get('Library/Folder/sample.pdf.md');
    const registry = new AttachmentRegistry(f.app, { ...DEFAULT_SETTINGS });
    await registry.refresh();
    const record = registry.records.get('Folder/sample.pdf')!;
    expect(registry.state(record)).toBe('missing');
    expect(registry.records.size).toBe(1);
    expect(f.writes).toHaveLength(0);
});
