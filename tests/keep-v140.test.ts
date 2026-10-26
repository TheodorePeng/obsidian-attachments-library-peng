import { it, expect } from 'vitest';
import { stringifyYaml } from 'obsidian';
import { fixture } from './fixture';
import { DEFAULT_SETTINGS } from '../src/types';
import { newMetadata } from '../src/managed-properties';
import { AttachmentRegistry } from '../src/registry';
import { ReferenceService } from '../src/references';
import { DeletionService } from '../src/deletions';
it('explains canonical, legacy and damaged keep protection in both deletion modes',async()=>{for(const props of [{keep:true},{al_keep:true,keep:false},{keep:'no'},{keep:undefined}]){const m={...newMetadata('a.png'),...props};if(m.keep===undefined)delete m.keep;const f=fixture({'a.png':'x','Library/a.md':'---\n'+stringifyYaml(m)+'---\nOCR'});const registry=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});await registry.refresh();const refs=new ReferenceService(f.app,registry);await refs.refresh();const deletions=new DeletionService(f.app,registry,refs);for(const mode of ['pair','metadata-only'] as const){const plan=await deletions.prepare(['a.png'],mode);expect(plan.targets).toHaveLength(0);expect(plan.reviews[0].blockedReason).toContain('keep');}refs.dispose();}});
