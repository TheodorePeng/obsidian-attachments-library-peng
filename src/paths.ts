import { App, TFile, TFolder, FileSystemAdapter, normalizePath } from 'obsidian';
import { isEligiblePath } from './file-policy';
import { AttachmentsLibrarySettings } from './types';

/** Validate before normalization so traversal and absolute paths cannot disappear. */
export function vaultPath(value: string): string {
    const raw = value.trim();
    if (!raw || /^[\\/]|^[a-z][a-z\d+.-]*:/i.test(raw)) throw new Error('Enter a Vault-relative path.');
    const parts = raw.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    if (parts.some(part => !part || part.startsWith('.') || (/[<>:"|?*]/.test(part) || [...part].some(char => char.charCodeAt(0) < 32)) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid or hidden path segment.');
    return normalizePath(parts.join('/'));
}
export function baseName(value: string): string {
    const path = vaultPath(value);
    if (path.includes('/')) throw new Error('Create the Base in the Vault root; enter a file name only.');
    return /\.base$/i.test(path) ? path : path + '.base';
}
export function inputVaultPath(app: App, value: string): string {
    const raw = value.trim().replace(/\\/g, '/');
    if (raw.startsWith('/') || /^[a-z]:\//i.test(raw)) {
        const adapter = app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) throw new Error('Enter a Vault-relative path on this device.');
        const root = adapter.getBasePath().replace(/\\/g, '/').replace(/\/$/, '');
        if (!raw.startsWith(root + '/')) throw new Error('Choose a path inside the current Vault.');
        return inputVaultPath(app, raw.slice(root.length + 1));
    }
    const path = vaultPath(raw);
    if (path === app.vault.configDir || path.startsWith(app.vault.configDir + '/')) throw new Error('Choose a path outside the Vault configuration directory.');
    return path;
}
export function occupiedPaths(app: App): Set<string> {
    const paths = app.vault.getAllLoadedFiles ? app.vault.getAllLoadedFiles().map(f => f.path) : app.vault.getFiles().map(f => f.path);
    return new Set(paths.map(path => path.toLocaleLowerCase()));
}
export function allocateIndexPath(assetPath: string, folder: string, occupied: ReadonlySet<string>, reserved = new Set<string>()): string {
    const destination = vaultPath(folder), name = assetPath.split('/').pop();
    if (!name) throw new Error('Missing attachment file name.');
    let number = 1;
    for (;;) {
        const path = `${destination}/${name}${number === 1 ? '' : ` (${number})`}.md`;
        const key = path.toLocaleLowerCase();
        if (!occupied.has(key) && !reserved.has(key)) { reserved.add(key); return path; }
        number++;
    }
}
export function validateFolder(app: App, value: string, settings: AttachmentsLibrarySettings, checkScope = true): string {
    const folder = inputVaultPath(app, value), parts = folder.split('/');
    for (let i = 1; i <= parts.length; i++) {
        const existing = app.vault.getAbstractFileByPath(parts.slice(0, i).join('/'));
        if (existing && !(existing instanceof TFolder)) throw new Error(existing instanceof TFile && existing.extension.toLowerCase() === 'base' ? 'This is a Base file. Choose a folder for index notes. The saved location is unchanged.' : 'A file occupies the folder path. The saved location is unchanged.');
    }
    if (!checkScope) return folder;
    const under = (path: string, parent: string) => path === parent || path.startsWith(parent + '/');
    if (settings.indexScope === 'folder' && under(settings.attachmentsFolder, folder)) throw new Error('Index notes folder must not contain the attachment scope.');
    const scope = { ...settings, libraryFolder: '' };
    const examples = app.vault.getFiles().filter(file => under(file.path, folder) && isEligiblePath(file.path, scope)).slice(0, 3);
    if (examples.length) throw new Error('This folder contains managed attachments. Choose an independent index folder. Examples: ' + examples.map(file => file.path).join(', '));
    return folder;
}
export function existingBase(app: App, value: string): TFile {
    const path = inputVaultPath(app, value), file = app.vault.getFileByPath(path);
    if (!file || file.extension.toLowerCase() !== 'base') throw new Error('Choose an existing .base file.');
    return file;
}
