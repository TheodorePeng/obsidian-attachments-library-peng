import { App, parseYaml } from 'obsidian';
import { AttachmentsLibrarySettings, DEFAULT_SETTINGS } from './types';
import { VIEW_TYPE } from './bases-creator';
import { normalizeExtensions } from './file-policy';
export interface DestinationView { name: string; owner: string; }
export function galleryViews(text: string): DestinationView[] {
    let parsed: unknown; try { parsed = parseYaml(text); } catch { throw new Error('Invalid Base configuration. Check the YAML syntax.'); }
    const config = parsed as { views?: { name?: unknown; type?: unknown; alpOwned?: unknown }[] } | null;
    if (!config || typeof config !== 'object' || Array.isArray(config) || (config.views !== undefined && !Array.isArray(config.views))) throw new Error('Invalid Base views');
    if (config.views?.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('Invalid Base view');
    return (config.views ?? []).filter(v => v && v.type === VIEW_TYPE && typeof v.name === 'string').map(v => ({ name: v.name as string, owner: typeof v.alpOwned === 'string' ? v.alpOwned : '' }));
}
export async function settingsFromSaved(app: App, saved: Partial<AttachmentsLibrarySettings> | null): Promise<AttachmentsLibrarySettings> {
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    settings.watchedExtensions = normalizeExtensions(settings.watchedExtensions);
    settings.legacyIndexPaths = Array.isArray(saved?.legacyIndexPaths) ? saved.legacyIndexPaths.filter(path => typeof path === 'string' && path.toLowerCase().endsWith('.md')) : [];
    const report = saved?.lastOperationReport;
    settings.lastOperationReport = report && typeof report.summary === 'string' && typeof report.recovery === 'string' ? report : undefined;
    const fresh = !saved || Object.keys(saved).length === 0;
    settings.autoCreateOnNew = fresh ? true : saved.autoCreateOnNew === true;
    if (!fresh && saved?.settingsVersion !== 2) {
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
    if (!file || file.extension.toLowerCase() !== 'base') throw new Error('Default Base is missing. Choose another file or create one in Gallery settings.');
    const views = galleryViews(await app.vault.cachedRead(file));
    const matches = views.filter(v => v.name === settings.defaultViewName);
    const selected = matches.length === 1 ? matches : settings.defaultViewOwner ? views.filter(v => v.owner === settings.defaultViewOwner) : [];
    if (selected.length !== 1) throw new Error('Default gallery view is missing or ambiguous. Select a view or repair it in settings.');
    const leaf = app.workspace.getLeavesOfType('bases').find(leaf => { const state = leaf.getViewState().state; return state?.file === path && state.viewName === selected[0].name; }) ?? app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true });
    await leaf.setViewState({ type: 'bases', state: { file: path, viewName: selected[0].name } });
    await leaf.loadIfDeferred();
    app.workspace.setActiveLeaf(leaf, { focus: true });
}

export function preferredView(views: DestinationView[], path: string, settings: AttachmentsLibrarySettings): string {
    const current = views.filter(view => view.name === settings.defaultViewName);
    if (path === settings.defaultBasePath && current.length === 1) return current[0].name;
    const preferred = views.filter(view => view.owner === VIEW_TYPE + ':all');
    const chosen = preferred.length === 1 ? preferred[0] : views.length === 1 ? views[0] : undefined;
    return chosen && views.filter(view => view.name === chosen.name).length === 1 ? chosen.name : '';
}
