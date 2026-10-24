import { describe, it, expect } from 'vitest';
import { BasesCreator, upgradeBase, VIEW_TYPE } from '../src/bases-creator';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
import { parseYaml } from 'obsidian';
describe('BasesCreator', () => {
    it('computes configured paths and creates an explicit library with native table and owned views', async () => { const f = fixture({}); const b = new BasesCreator(f.app, { ...DEFAULT_SETTINGS, baseFolderPath: 'Databases' }); expect(b.getBaseFilePathForFolder('  ')).toBe('Attachments Library.base'); expect(b.getBaseFilePath()).toBe('Databases/Attachments Library.base'); await b.createOrUpdateBaseFile(); const parsed = parseYaml(f.data.get(b.getBaseFilePath())!); expect(parsed.views[0].type).toBe('table'); expect(parsed.views.filter((v: any) => v.type === VIEW_TYPE)).toHaveLength(4); expect(f.app.vault.createFolder).toHaveBeenCalledWith('Databases'); });
    it('preserves filters, CMS, table, unknown config and custom properties during idempotent upgrade', () => { const original = 'filters:\n  and: ["status == \\"reading\\""]\nviews:\n  - type: cms\n    name: Custom\n    sort: [{property: title, direction: ASC}]\n    unknown: [a, b]\ncustom: true\n'; const first = upgradeBase(original, 'Library'); const config = parseYaml(first); expect(config.custom).toBe(true); expect(config.views[0].unknown).toEqual(['a', 'b']); expect(upgradeBase(first, 'Library')).toBe(first); });
    it('refuses malformed YAML or invalid view shape without writing', async () => { for (const source of ['invalid: [', '[]', 'views: nope', 'views: [null]']) {
        const f = fixture({ 'QA.base': source });
        const b = new BasesCreator(f.app, { ...DEFAULT_SETTINGS });
        await expect(b.createOrUpdateBaseFile('QA.base')).rejects.toThrow();
        expect(f.writes).toHaveLength(0);
    } });
    it('normalizes owned view definitions while preserving extra options', () => { const source = 'views:\n  - type: wrong\n    name: Wrong\n    alpOwned: attachments-library-peng:all\n    pageSize: 30\n    custom: keep\n'; const p = parseYaml(upgradeBase(source, 'Library')); expect(p.views[0].type).toBe(VIEW_TYPE); expect(p.views[0].pageSize).toBe(30); expect(p.views[0].custom).toBe('keep'); expect(p.views[0].alpMode).toBe('all'); });
    it('creates unique non-overwriting backups only when changed', async () => { const f = fixture({ 'QA.base': 'views: []\n', 'QA.base.alp-backup': 'old backup' }); const b = new BasesCreator(f.app, { ...DEFAULT_SETTINGS }); await b.createOrUpdateBaseFile('QA.base'); expect(f.data.get('QA.base.alp-backup')).toBe('old backup'); expect(f.data.get('QA.base.alp-backup-1')).toBe('views: []\n'); const count = f.writes.length; await b.createOrUpdateBaseFile('QA.base'); expect(f.writes).toHaveLength(count); await expect(b.createOrUpdateBaseFile('oops.md')).rejects.toThrow('.base'); });
    it('moves existing Base only explicitly and refuses replacement', async () => { const f = fixture({ 'Attachments Library.base': 'views: []', 'Taken/Attachments Library.base': 'views: []' }); const b = new BasesCreator(f.app, { ...DEFAULT_SETTINGS }); await b.moveBaseFile('', ''); await b.moveBaseFile('missing', 'Other'); expect(f.app.fileManager.renameFile).not.toHaveBeenCalled(); await expect(b.moveBaseFile('', 'Taken')).rejects.toThrow('exists'); await b.moveBaseFile('', 'New'); expect(f.app.fileManager.renameFile).toHaveBeenCalledWith(f.files.get('Attachments Library.base'), 'New/Attachments Library.base'); });
});
