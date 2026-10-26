import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_METADATA } from '../src/types';
describe('DEFAULT_SETTINGS', () => {
    it('has attachmentsFolder "Attachments"', () => {
        expect(DEFAULT_SETTINGS.attachmentsFolder).toBe('Attachments');
    });
    it('has libraryFolder "Library"', () => {
        expect(DEFAULT_SETTINGS.libraryFolder).toBe('Library');
    });
    it('watchedExtensions includes .pdf and .jpg', () => {
        expect(DEFAULT_SETTINGS.watchedExtensions).toContain('.pdf');
        expect(DEFAULT_SETTINGS.watchedExtensions).toContain('.jpg');
    });
    it('watchedExtensions includes image and media types', () => {
        expect(DEFAULT_SETTINGS.watchedExtensions).toContain('.png');
        expect(DEFAULT_SETTINGS.watchedExtensions).toContain('.mp4');
    });
    it('autoCreateOnNew starts disabled', () => {
        expect(DEFAULT_SETTINGS.autoCreateOnNew).toBe(false);
    });
    it('autoDeleteOnRemove is false', () => {
        expect(DEFAULT_SETTINGS.autoDeleteOnRemove).toBe(false);
    });
    it('mirrorFolderStructure is true', () => {
        expect(DEFAULT_SETTINGS.mirrorFolderStructure).toBe(true);
    });
    it('legacy PDF extraction starts disabled', () => {
        expect(DEFAULT_SETTINGS.enablePdfMetadataExtraction).toBe(false);
    });
    it('enableDoiIsbnLookup is false', () => {
        expect(DEFAULT_SETTINGS.enableDoiIsbnLookup).toBe(false);
    });
    it('autoCreateBaseFile is false', () => {
        expect(DEFAULT_SETTINGS.autoCreateBaseFile).toBe(false);
    });
    it('tagsPropertyName is "tags"', () => {
        expect(DEFAULT_SETTINGS.tagsPropertyName).toBe('tags');
    });
});
it('generates only user URL and keep defaults', () => { expect(DEFAULT_METADATA).toEqual({url:'',keep:false}); });
