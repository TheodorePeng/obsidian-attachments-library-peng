// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modalInstances, settingInstances, menuInstances, noticeMessages, editorInfoField } from 'obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { AttachmentRegistry } from '../src/registry';
import { ReferenceService } from '../src/references';
import { SidecarManager } from '../src/sidecar-manager';
import { DeletionService } from '../src/deletions';
import { AttachmentsLibraryView, PageSelection, previewAttachment, requestDeletion } from '../src/library-view';
import { ImageNavigation } from '../src/image-navigation';
import { confirmAction } from '../src/dialogs';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
beforeEach(() => { document.body.replaceChildren(); modalInstances.length = 0; settingInstances.length = 0; menuInstances.length = 0; noticeMessages.length = 0; });
async function services(contents: Record<string, string> = {}, overrides: any = {}) { const f = fixture({ 'a.png': 'x', 'Library/a.md': '---\n_filePath: a.png\nattachment: "[[a.png]]"\ntitle: 数学\nsource: https://example.com\n---\n', ...contents }); const settings = { ...DEFAULT_SETTINGS, ...overrides }; const registry = new AttachmentRegistry(f.app, settings); await registry.refresh(); const references = new ReferenceService(f.app, registry); await references.refresh(); const sidecarManager = new SidecarManager(f.app, settings, registry); sidecarManager.references = references; const deletions = new DeletionService(f.app, registry, references); const refreshUsage = vi.fn(async () => { await registry.refresh(); await references.refresh(); }); return { ...f, settings, registry, references, sidecarManager, deletions, refreshUsage }; }
function mount() { const root = document.createElement('div'); document.body.append(root); return root; }
function choose(confirm = true) { const setting = settingInstances.at(-1); setting.buttonCallbacks[confirm ? 1 : 0](); }
function embed(root: HTMLElement, path = 'a.png|200') { const host = document.createElement('span'); host.className = 'internal-embed image-embed'; host.setAttribute('src', path); host.append(document.createElement('img')); root.append(host); return host; }
const event = (type: string, options: any = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
function viewFor(s: any, root: HTMLElement, options: any = {}, entries?: any[]) { const rows = entries ?? [...s.registry.byIndex.values()].map((r: any) => ({ file: r.index })); const config = { get: (key: string) => options[key] }; const controller = { app: s.app, config, data: { groupedData: [{ entries: rows, key: { toString: () => 'Group A' }, hasKey: () => true }] } }; return new AttachmentsLibraryView(controller as any, root, s); }
describe('confirmation dialogs', () => {
    it('resolves confirm and cancel, and closes without affirmative action safely', async () => { const s = await services(); const yes = confirmAction(s.app, 'Title', ['one', 'two']); expect(modalInstances.at(-1).contentEl.textContent).toContain('one'); choose(); expect(await yes).toBe(true); const no = confirmAction(s.app, 'Title', []); choose(false); expect(await no).toBe(false); const close = confirmAction(s.app, 'Title', []); modalInstances.at(-1).close(); expect(await close).toBe(false); });
});
describe('paged library view', () => {
    it('bounds pagination, clears selection on move/reset and toggles individual selections', () => { const p = new PageSelection(2); p.toggle('x', true); expect(p.selected.has('x')).toBe(true); p.toggle('x', false); expect(p.selected.size).toBe(0); p.move(8, 5); expect(p.page).toBe(2); expect(p.slice([1, 2, 3, 4, 5])).toEqual([5]); p.toggle('x', true); p.move(-1, 0); expect(p.page).toBe(0); expect(p.selected.size).toBe(0); p.reset(); });
    it('renders exactly 60 rows, supports grouped results and page/filter changes clear selection', async () => { const extra: Record<string, string> = {}; for (let i = 0; i < 64; i++) {
        extra[`f${i}.png`] = 'x';
        extra[`Library/f${i}.md`] = `---\n_filePath: f${i}.png\nattachment: "[[f${i}.png]]"\n---\n`;
    } const s = await services(extra); const root = mount(); const v = viewFor(s, root); v.onDataUpdated(); expect(root.querySelectorAll('.alp-card')).toHaveLength(60); expect(root.querySelector('h3')?.textContent).toBe('Group A'); const check = root.querySelector('.alp-toolbar input') as HTMLInputElement; check.checked = true; check.dispatchEvent(new Event('change')); expect(v.selection.selected.size).toBe(60); [...root.querySelectorAll('button')].find(b => b.textContent === 'Next')!.click(); expect(v.selection.selected.size).toBe(0); expect(root.querySelectorAll('.alp-card')).toHaveLength(5); [...root.querySelectorAll('button')].find(b => b.textContent === 'Previous')!.click(); expect(root.querySelectorAll('.alp-card')).toHaveLength(60); v.selection.toggle('x', true); v.onDataUpdated(); expect(v.selection.selected.size).toBe(0); v.onunload(); expect(root.children).toHaveLength(0); expect(root.classList.contains('alp-library')).toBe(false); });
    it('uses only this.data rows and realtime usage/keep for orphan, cleanable, problems modes', async () => { const s = await services({ 'b.png': 'x', 'Library/b.md': '---\n_filePath: b.png\nattachment: "[[b.png]]"\nal_keep: true\n---\n', 'unrelated.md': 'body' }); const root = mount(); const options: any = { alpMode: 'cleanable', pageSize: 1 }; const v = viewFor(s, root, options, [{ file: s.files.get('unrelated.md') }, ...s.registry.byIndex.values()].map((x: any) => x.file ? x : { file: x.index })); v.onDataUpdated(); expect(root.querySelectorAll('.alp-card')).toHaveLength(1); expect(root.textContent).toContain('a.png'); options.alpMode = 'orphan'; options.pageSize = 2000; v.onDataUpdated(); expect(root.querySelectorAll('.alp-card')).toHaveLength(2); expect(v.selection.size).toBe(200); s.references.pending = true; options.alpMode = 'cleanable'; v.onDataUpdated(); expect(root.querySelectorAll('.alp-card')).toHaveLength(0); options.alpMode = 'problems'; v.onDataUpdated(); expect(root.querySelectorAll('.alp-card')).toHaveLength(2); options.alpMode = 'all'; options.pageSize = 0; v.onDataUpdated(); expect(v.selection.size).toBe(1); });
    it('opens metadata, toggles keep, displays references and refreshes without per-card rescans', async () => { const s = await services(); const root = mount(); const v = viewFor(s, root); v.onDataUpdated(); const title = root.querySelector('.alp-details a')!; title.dispatchEvent(event('click', { metaKey: true })); expect(s.app.workspace.getLeaf).toHaveBeenCalledWith('tab'); title.dispatchEvent(event('click')); expect(s.app.workspace.getLeaf).toHaveBeenCalledWith(false); const select = root.querySelector('.alp-card > input') as HTMLInputElement; select.checked = true; select.dispatchEvent(new Event('change')); expect(v.selection.selected.size).toBe(1); const keep = root.querySelector('.alp-keep input') as HTMLInputElement; keep.checked = true; keep.dispatchEvent(new Event('change')); await vi.waitFor(() => expect(s.registry.records.get('a.png')?.metadata.al_keep).toBe(true)); [...root.querySelectorAll('button')].find(b => b.textContent === 'orphan · 0 sources')!.click(); expect(modalInstances.at(-1).titleEl.textContent).toBe('Reference details'); choose(); [...root.querySelectorAll('button')].find(b => b.textContent === 'Refresh references')!.click(); await vi.waitFor(() => expect(s.refreshUsage).toHaveBeenCalledOnce()); root.querySelector('.alp-card')!.dispatchEvent(event('contextmenu')); expect(menuInstances.at(-1).items).toHaveLength(2); });
    it('renders lazy images and icon placeholders and previews native media only on click', async () => { const extra: Record<string, string> = {}; for (const ext of ['pdf', 'mp3', 'mp4', 'zip']) {
        extra[`file.${ext}`] = 'x';
        extra[`Library/${ext}.md`] = `---\n_filePath: file.${ext}\nattachment: "[[file.${ext}]]"\n---\n`;
    } const s = await services(extra, { watchedExtensions: [...DEFAULT_SETTINGS.watchedExtensions, '.zip'] }); const root = mount(); const v = viewFor(s, root); v.onDataUpdated(); expect(root.querySelectorAll('audio,video,iframe')).toHaveLength(0); expect(root.querySelector('img')?.getAttribute('loading')).toBe('lazy'); for (const record of s.registry.records.values()) {
        previewAttachment(s.app, record);
        const modal = modalInstances.at(-1);
        expect(modal.titleEl.textContent).toBe(record.asset!.name);
        if (record.assetPath.endsWith('.zip'))
            modal.contentEl.querySelector('button').click();
        modal.close();
    } previewAttachment(s.app, { assetPath: 'missing.png' } as any); root.querySelector<HTMLButtonElement>('.alp-thumbnail')!.click(); expect(modalInstances.at(-1).contentEl.querySelector('img')).toBeTruthy(); });
    it('previews selected deletion, permits cancel and shows results and blocked reasons', async () => { const s = await services(); const plan: any = { targets: [{ files: [{ path: 'a.png' }, { path: 'Library/a.md' }], hasUserBody: true }], skipped: [{ path: 'keep.png', reason: 'keep' }] }; const prepare = vi.spyOn(s.deletions, 'prepare').mockResolvedValue(plan); const execute = vi.spyOn(s.deletions, 'execute').mockResolvedValue({ status: 'complete', message: 'done', steps: [{ path: 'a.png', status: 'trashed', recovery: '.trash', step: 'asset' }] }); const canceled = requestDeletion(s.app, s, ['a.png'], 'pair'); await vi.waitFor(() => expect(modalInstances.length).toBe(1)); expect(modalInstances.at(-1).contentEl.textContent).toContain('Protected, kept: keep.png'); choose(false); await canceled; expect(execute).not.toHaveBeenCalled(); const done = requestDeletion(s.app, s, ['a.png'], 'metadata-only'); await vi.waitFor(() => expect(modalInstances.length).toBe(2)); choose(); await vi.waitFor(() => expect(modalInstances.length).toBe(3)); choose(); await done; expect(execute).toHaveBeenCalledOnce(); prepare.mockRejectedValue(new Error('keep protected')); const blocked = requestDeletion(s.app, s, ['a.png'], 'pair'); await vi.waitFor(() => expect(modalInstances.length).toBe(4)); expect(modalInstances.at(-1).contentEl.textContent).toContain('keep protected'); choose(); await blocked; });
    it('routes card menu and toolbar deletion modes through the same prepare service', async () => { const s = await services(); vi.spyOn(s.deletions, 'prepare').mockRejectedValue(new Error('blocked')); const root = mount(); const v = viewFor(s, root); v.onDataUpdated(); root.querySelector('.alp-card')!.dispatchEvent(event('contextmenu')); for (const item of menuInstances.at(-1).items) {
        item.callback();
        await vi.waitFor(() => expect(modalInstances.at(-1).titleEl.textContent).toBe('Deletion blocked'));
        choose();
    } const input = root.querySelector('.alp-card > input') as HTMLInputElement; input.checked = true; input.dispatchEvent(new Event('change')); for (const text of ['Delete metadata only', 'Delete attachment + metadata']) {
        const input = root.querySelector('.alp-card > input') as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        [...root.querySelectorAll('button')].find(b => b.textContent === text)!.click();
        await new Promise(resolve => setTimeout(resolve, 5));
        choose();
        await new Promise(resolve => setTimeout(resolve, 5));
    } expect(s.deletions.prepare).toHaveBeenCalledWith(['Library/a.md'], 'pair'); expect(s.deletions.prepare).toHaveBeenCalledWith(['Library/a.md'], 'metadata-only'); });
});
describe('image overlay navigation', () => {
    it('injects a single anchor, routes normal/Cmd/middle/context actions and always hovers the index', async () => { const s = await services(); const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager); const root = mount(); const host = embed(root); const parent = { hoverPopover: null }; const cleanup = images.observe(root, () => 'note.md', parent); images.decorate(root, 'note.md'); expect(host.querySelectorAll('a')).toHaveLength(1); const a = host.querySelector('a')!; expect(a.getAttribute('href')).toBe('Library/a.md'); a.dispatchEvent(event('mouseover', { metaKey: true })); expect(s.app.workspace.trigger).toHaveBeenCalledWith('hover-link', expect.objectContaining({ linktext: 'Library/a.md', hoverParent: parent })); a.dispatchEvent(event('click')); await vi.waitFor(() => expect(s.app.workspace.getLeaf).toHaveBeenCalledWith(false)); const open = vi.spyOn(window, 'open').mockImplementation(() => null); a.dispatchEvent(event('click', { metaKey: true })); expect(open).toHaveBeenCalledWith('https://example.com', '_blank'); a.dispatchEvent(event('auxclick', { button: 1 })); await vi.waitFor(() => expect(s.app.workspace.getLeaf).toHaveBeenCalledWith('tab')); a.dispatchEvent(event('auxclick', { button: 2 })); a.dispatchEvent(event('contextmenu', { button: 2 })); expect(menuInstances.at(-1).items).toHaveLength(3); for (const item of menuInstances.at(-1).items)
        item.callback(); a.dispatchEvent(event('click', { button: 2 })); expect(menuInstances.length).toBe(2); s.settings.imageClickMode = 'nativeCmdClick'; const native = event('click', { ctrlKey: true }); a.dispatchEvent(native); expect(native.defaultPrevented).toBe(false); cleanup(); expect(host.querySelector('a')).toBeNull(); images.dispose(); open.mockRestore(); });
    it('removes stale controls when a reused embed becomes remote, unresolved, nonimage or empty', async () => { const s = await services({ 'audio.mp3': 'x' }); const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager); const root = mount(); for (const target of ['https://example.com/a.png', 'missing.png', 'audio.mp3', '']) {
        const host = embed(root);
        images.decorate(root, 'note.md');
        expect(host.querySelector('a')).toBeTruthy();
        host.setAttribute('src', target);
        images.decorate(root, 'note.md');
        expect(host.querySelector('a')).toBeNull();
        host.remove();
    } const host = embed(root); images.decorate(root, ''); host.querySelector('img')!.remove(); images.decorate(root, ''); expect(host.querySelector('a')).toBeNull(); const disconnected = embed(root); images.decorate(root, ''); disconnected.remove(); images.decorate(root, ''); images.dispose(); images.decorate(root, ''); expect(root.querySelector('a')).toBeNull(); });
    it('refreshes early hrefs once registry becomes ready without recreating controls or scanning Vault', async () => { const s = await services(); const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager); const record = s.registry.records.get('a.png')!; s.registry.records.clear(); const root = mount(); const host = embed(root); images.observe(root, () => 'note.md', { hoverPopover: null }); const anchor = host.querySelector('a')!; expect(anchor.getAttribute('href')).toBe('#'); anchor.dispatchEvent(event('mouseover')); expect(s.app.workspace.trigger).not.toHaveBeenCalled(); s.registry.records.set('a.png', record); images.refresh(); expect(host.querySelector('a')).toBe(anchor); expect(anchor.getAttribute('data-href')).toBe('Library/a.md'); images.dispose(); expect(host.classList.contains('alp-image-host')).toBe(false); });
    it('keeps unindexed hover read-only and offers explicit single creation on click', async () => { const s = await services({ 'new.png': 'x' }); const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager); const root = mount(); const host = embed(root, 'new.png'); images.observe(root, () => 'note.md', {}); host.querySelector('a')!.dispatchEvent(event('mouseover')); expect(s.writes).toHaveLength(0); const canceled = images.openIndex('new.png'); choose(false); await canceled; expect(s.writes).toHaveLength(0); const creating = images.openIndex('new.png', true); choose(); await creating; expect(s.files.has('Library/new.png.md')).toBe(true); expect(s.settings.initialScanComplete).toBe(false); expect(host.querySelector('a')!.getAttribute('href')).toBe('Library/new.png.md'); images.dispose(); });
    it('rejects missing/invalid source URLs and conflicts without accidentally opening metadata', async () => { const s = await services(); const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager); const open = vi.spyOn(window, 'open').mockImplementation(() => null); images.openSource(); const record = s.registry.records.get('a.png')!; record.metadata.source = 'javascript:alert(1)'; images.openSource(record); expect(open).not.toHaveBeenCalled(); record.conflict = true; images.openSource(record); await images.openIndex('a.png'); expect(noticeMessages.some(m => m.includes('conflict'))).toBe(true); expect(s.app.workspace.getLeaf).not.toHaveBeenCalled(); await images.openIndex('absent.png'); open.mockRestore(); });
    it('observes Live Preview DOM using editorInfoField source context and cleans up on destroy', async () => { const s = await services({ 'notes/source.md': '' }); const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager); const root = mount(); const extension = images.editorExtension(); const state = EditorState.create({ doc: 'text', extensions: [editorInfoField.init(() => ({ file: s.files.get('notes/source.md') })), extension] }); const view = new EditorView({ state, parent: root }); const host = embed(view.dom); await vi.waitFor(() => expect(host.querySelector('a')).toBeTruthy()); view.dispatch({ changes: { from: 0, insert: 'a' } }); const instance = view.plugin(extension)!; instance.update({ docChanged: false, viewportChanged: true } as any); instance.update({ docChanged: false, viewportChanged: false } as any); host.querySelector('a')!.dispatchEvent(event('mouseover')); expect(s.app.workspace.trigger).toHaveBeenCalledWith('hover-link', expect.objectContaining({ sourcePath: 'notes/source.md' })); view.destroy(); expect(host.querySelector('a')).toBeNull(); images.dispose(); });
});
it('keeps controls stable in detached Markdown render containers and scopes cleanup to their owner', async () => {
    const s = await services();
    const images = new ImageNavigation(s.app, s.settings, s.registry, s.sidecarManager);
    const detached = document.createElement('div');
    const host = embed(detached);
    images.decorate(detached, 'note.md');
    const anchor = host.querySelector('.alp-image-link');
    expect(anchor).toBeTruthy();
    images.decorate(detached, 'note.md');
    expect(host.querySelector('.alp-image-link')).toBe(anchor);
    const mounted = mount();
    images.decorate(mounted, 'other.md');
    expect(host.querySelector('.alp-image-link')).toBe(anchor);
    const stop = images.observe(detached, () => 'note.md', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(host.querySelectorAll('.alp-image-link')).toHaveLength(1);
    detached.removeChild(host);
    images.decorate(detached, 'note.md');
    expect(host.querySelector('.alp-image-link')).toBeNull();
    stop(); images.dispose();
});
