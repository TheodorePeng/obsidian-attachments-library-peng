import { it, expect } from 'vitest';
import { parseYaml } from 'obsidian';
import { upgradeBase, reviewBaseConfiguration, BasesCreator } from '../src/bases-creator';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
it('keeps user-owned view names and filters; new defaults include moved schema indexes',()=>{
    const original='filters: status == "reading"\nviews:\n - type: attachments-library-peng\n   name: My Gallery\n   alpOwned: attachments-library-peng:all\n   alpMode: all\n';
    const upgraded=parseYaml(upgradeBase(original,'Library'));expect(upgraded.views[0].name).toBe('My Gallery');expect(upgraded.filters).toBe('status == "reading"');
    const created=parseYaml(upgradeBase('','Library'));expect(created.views.some((v:any)=>v.name==='附件管理')).toBe(true);expect(JSON.stringify(created.filters)).toContain('al_schema == 1');
});
it('configuration preview preserves referenced view names and only changes the proposed copy',()=>{
    const original='filters: file.inFolder("Library")\nviews:\n - type: cms\n   name: CMS\n - type: attachments-library-peng\n   name: All attachments\n   alpOwned: attachments-library-peng:all\n';
    const p=reviewBaseConfiguration(original,'Library',new Set(['All attachments']));expect(parseYaml(p.content).views[1].name).toBe('All attachments');expect(parseYaml(p.content).views[0].name).toBe('CMS');expect(p.changes.some(x=>x.includes('保留'))).toBe(true);
    const renamed=reviewBaseConfiguration(original,'Library',new Set());expect(parseYaml(renamed.content).views[1].name).toBe('附件管理');expect(reviewBaseConfiguration(renamed.content,'Library',new Set()).content).toBe(renamed.content);
    expect(()=>reviewBaseConfiguration('[]','Library',new Set())).toThrow();
});
it('does not mutate an existing Base until explicitly asked to upgrade',async()=>{
    const f=fixture({'Library.base':'views: []'});const creator=new BasesCreator(f.app,{...DEFAULT_SETTINGS});await creator.createOrUpdateBaseFile('Library.base');expect(f.writes).toHaveLength(0);await creator.createOrUpdateBaseFile('Library.base',true);expect(f.writes).toHaveLength(2);
});
