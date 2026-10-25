import { expect, it } from 'vitest';
import { BasesCreator } from '../src/bases-creator';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
import { parseYaml } from 'obsidian';
it('upgrades an explicit QA Base preserving custom config, creates backup and is idempotent', async () => { const original = 'filters: file.inFolder("Library")\nviews:\n  - type: cms\n    name: Mine\n    custom: yes\nunknown: 42\n'; const f = fixture({ 'QA.base': original }); const b = new BasesCreator(f.app, { ...DEFAULT_SETTINGS }); await b.createOrUpdateBaseFile('QA.base', true); const parsed = parseYaml(f.data.get('QA.base')!); expect(parsed.unknown).toBe(42); expect(parsed.views[0].type).toBe('cms'); expect(parsed.views).toHaveLength(5); const writes = f.writes.length; await b.createOrUpdateBaseFile('QA.base', true); expect(f.writes).toHaveLength(writes); expect([...f.data.values()]).toContain(original); });
