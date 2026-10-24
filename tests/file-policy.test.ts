import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTENSIONS, classifyMedia, isEligiblePath, normalizeExtensions } from '../src/file-policy';
const settings = { indexScope: 'vault' as const, attachmentsFolder: 'Attachments', libraryFolder: 'Library', watchedExtensions: DEFAULT_EXTENSIONS };
describe('attachment-only policy', () => {
    it('uses the approved native format list including 3gp and mkv', () => {
        expect(new Set(DEFAULT_EXTENSIONS)).toEqual(new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp', '.flac', '.m4a', '.mp3', '.ogg', '.wav', '.3gp', '.mkv', '.mov', '.mp4', '.ogv', '.webm', '.pdf']));
    });
    it('normalizes user values without mutating the input', () => { const input = [' PNG ', ' .pdf', 'png', '', '  ', 'PDF']; expect(normalizeExtensions(input)).toEqual(['.png', '.pdf']); expect(input[0]).toBe(' PNG '); });
    it.each(['md', 'MD', 'markdown', 'mdown', 'mkd', 'mdx', 'base', 'canvas'])('cannot index %s even if explicitly listed', ext => { expect(isEligiblePath('Notes/note.' + ext, { ...settings, watchedExtensions: ['.' + ext] })).toBe(false); });
    it.each(['.obsidian/config.png', '.trash/a.pdf', 'a/.hidden/b.png', '.asset.png', 'a/../b.png'])('ignores hidden or traversal path %s', path => expect(isEligiblePath(path, settings)).toBe(false));
    it('excludes Library as a complete path segment', () => { expect(isEligiblePath('Library/a.png', settings)).toBe(false); expect(isEligiblePath('LibraryExtra/a.png', settings)).toBe(true); expect(isEligiblePath('A/Library/a.png', settings)).toBe(true); expect(isEligiblePath('Library', settings)).toBe(false); });
    it('restricts candidates in folder mode without matching lookalike directories', () => { const folder = { ...settings, indexScope: 'folder' as const }; expect(isEligiblePath('Attachments/a.png', folder)).toBe(true); expect(isEligiblePath('Attachments/a/sub.PDF', folder)).toBe(true); expect(isEligiblePath('Attachments2/a.png', folder)).toBe(false); expect(isEligiblePath('attachments/a.png', folder)).toBe(false); expect(isEligiblePath('elsewhere/a.png', folder)).toBe(false); });
    it('handles empty configured folders and unknown formats predictably', () => { expect(isEligiblePath('a.png', { ...settings, libraryFolder: '' })).toBe(true); expect(isEligiblePath('a.png', { ...settings, indexScope: 'folder', attachmentsFolder: '' })).toBe(false); expect(isEligiblePath('a.xyz', { ...settings, watchedExtensions: [' XYZ '] })).toBe(true); expect(isEligiblePath('no-extension', settings)).toBe(false); expect(isEligiblePath('a.mp3', { ...settings, watchedExtensions: ['.png'] })).toBe(false); });
    it('classifies every default type for previews without loading media', () => { for (const ext of ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
        expect(classifyMedia('a.' + ext.toUpperCase())).toBe('image'); for (const ext of ['flac', 'm4a', 'mp3', 'ogg', 'wav', '3gp'])
        expect(classifyMedia('a.' + ext)).toBe('audio'); for (const ext of ['mkv', 'mov', 'mp4', 'ogv', 'webm'])
        expect(classifyMedia('a.' + ext)).toBe('video'); expect(classifyMedia('中文.PDF')).toBe('pdf'); expect(classifyMedia('file')).toBe('other'); expect(classifyMedia('file.zip')).toBe('other'); });
});
it('removes every forbidden document type from the stored whitelist as well as candidate selection', () => {
    const forbidden = ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mkdown', 'mdtxt', 'mdtext', 'rmd', 'qmd', 'mdx', 'base', 'canvas'];
    expect(normalizeExtensions(['PNG', ...forbidden, 'pdf'])).toEqual(['.png', '.pdf']);
    for (const extension of forbidden) {
        expect(isEligiblePath('document.' + extension, { ...settings, watchedExtensions: [extension] })).toBe(false);
    }
});
