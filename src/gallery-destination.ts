import { App, parseYaml } from 'obsidian';
import { AttachmentsLibrarySettings, DEFAULT_SETTINGS } from './types';
import { VIEW_TYPE } from './bases-creator';
import { normalizeExtensions } from './file-policy';
export interface DestinationView { name: string; owner: string; }
export function galleryViews(text: string): DestinationView[] {
    const config = parseYaml(text) as { views?: { name?: unknown; type?: unknown; alpOwned?: unknown }[] } | null;
    if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.views)) throw new Error('Invalid Base views');
    return config.views.filter(v => v && v.type === VIEW_TYPE && typeof v.name === 'string').map(v => ({ name: v.name as string, owner: typeof v.alpOwned === 'string' ? v.alpOwned : '' }));
}
export async function settingsFromSaved(app: App, saved: Partial<AttachmentsLibrarySettings> | null): Promise<AttachmentsLibrarySettings> {
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    settings.watchedExtensions = normalizeExtensions(settings.watchedExtensions);
    settings.legacyIndexPaths = Array.isArray(saved?.legacyIndexPaths) ? saved.legacyIndexPaths.filter(path => typeof path === 'string' && path.toLowerCase().endsWith('.md')) : [];
    const report = saved?.lastOperationReport;
    settings.lastOperationReport = report && typeof report.summary === 'string' && typeof report.recovery === 'string' ? report : undefined;
    if (saved?.settingsVersion !== 2) {
        settings.autoCreateOnNew = !!saved?.autoCreateOnNew && !!saved?.initialScanComplete;
        settings.settingsVersion = 2;
        settings.defaultBasePath = ''; settings.defaultViewName = ''; settings.defaultViewOwner = '';
        const path = (saved?.baseFolderPath?.replace(/^\/+|\/+$/g, '') ? saved.baseFolderPath.replace(/^\/+|\/+$/g, '') + '/' : '') + 'Attachments Library.base';
        const file = app.vault.getFileByPath(path);
        if (file) {
            settings.defaultBasePath = path;
            try { const view = galleryViews(await app.vault.cachedRead(file)).find(v => v.owner === VIEW_TYPE + ':all'); if (view) { settings.defaultViewName = view.name; settings.defaultViewOwner = view.owner; } } catch { /* Show the existing path but require explicit repair. */ }
        }
    }
    return settings;
}
/** Opening never creates, updates, backs up, or repairs the chosen Base. */
export async function openDestination(app: App, settings: AttachmentsLibrarySettings): Promise<void> {
    const path = settings.defaultBasePath;
    if (!path) throw new Error('Choose a Default Base file in Gallery settings.');
    const file = app.vault.getFileByPath(path);
    if (!file || file.extension !== 'base') throw new Error('Default Base is missing. Choose another file or create one in Gallery settings.');
    const views = galleryViews(await app.vault.cachedRead(file));
    const matches = settings.defaultViewOwner ? views.filter(v => v.owner === settings.defaultViewOwner) : views.filter(v => v.name === settings.defaultViewName);
    if (matches.length !== 1) throw new Error('Default gallery view is missing or ambiguous. Select a view or repair it in settings.');
    const leaf = app.workspace.getLeavesOfType('bases').find(leaf => { const state = leaf.getViewState().state; return state?.file === path && state.viewName === matches[0].name; }) ?? app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true });
    await leaf.setViewState({ type: 'bases', state: { file: path, viewName: matches[0].name } });
    await leaf.loadIfDeferred();
    app.workspace.setActiveLeaf(leaf, { focus: true });
}
