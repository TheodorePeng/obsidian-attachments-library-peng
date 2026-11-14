import { expect, it } from 'vitest';
import { allocateIndexPath, baseName, existingBase, occupiedPaths, validateFolder, vaultPath } from '../src/paths';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
it('normalizes relative paths while rejecting absolute, traversal, hidden and unsafe names',()=>{
    expect(vaultPath(' 资料\\笔记/ ')).toBe('资料/笔记'); expect(baseName('Gallery')).toBe('Gallery.base'); expect(baseName('Gallery.base')).toBe('Gallery.base');
    for(const path of ['', '/', '/a', '\\a', 'C:\\a', 'https://a', '../a', 'a/../b', 'a/./b', '.obsidian/a', 'a//b', 'a/CON', 'a/a?', 'a/a\0b', 'a/space /b', 'a/end.']) expect(()=>vaultPath(path)).toThrow();
    expect(()=>baseName('a/b')).toThrow('root'); expect(()=>allocateIndexPath('','Library',new Set())).toThrow('Missing');
});
it('allocates the lowest available numeric suffix and respects case, folders and reservations',()=>{
    const f=fixture({'Library/PHOTO.png.md':'user','Library/photo.png (3).md':'user'}); f.folder('Library/photo.png (2).md'); const occupied=occupiedPaths(f.app), reserved=new Set<string>();
    expect(allocateIndexPath('A/photo.png','Library',occupied,reserved)).toBe('Library/photo.png (4).md');
    expect(allocateIndexPath('B/photo.png','Library',occupied,reserved)).toBe('Library/photo.png (5).md');
    expect(allocateIndexPath('B/photo.pdf','Library',occupied,reserved)).toBe('Library/photo.pdf.md');
    f.app.vault.getAllLoadedFiles=undefined; expect(occupiedPaths(f.app).has('library/photo.png.md')).toBe(true);
});
it('validates directory node types and prevents scope exclusion without creating directories',()=>{
    const f=fixture({'blocked':'user','Attachments/a.png':'x','Mixed/b.png':'x','Notes/a.md':'user','A.base':'views: []'});
    expect(validateFolder(f.app,'New/索引',DEFAULT_SETTINGS)).toBe('New/索引'); expect(f.app.vault.createFolder).not.toHaveBeenCalled();
    expect(()=>validateFolder(f.app,'blocked/sub',DEFAULT_SETTINGS)).toThrow('file');
    expect(()=>validateFolder(f.app,'Mixed',DEFAULT_SETTINGS)).toThrow('contains managed attachments');
    const folder={...DEFAULT_SETTINGS,indexScope:'folder' as const,attachmentsFolder:'Attachments/Sub'};
    expect(()=>validateFolder(f.app,'Attachments',folder)).toThrow('scope'); expect(validateFolder(f.app,'Notes',folder)).toBe('Notes');
    expect(existingBase(f.app,' A.base ').path).toBe('A.base'); expect(()=>existingBase(f.app,'Notes/a.md')).toThrow('existing'); expect(()=>existingBase(f.app,'missing.base')).toThrow('existing');
});
