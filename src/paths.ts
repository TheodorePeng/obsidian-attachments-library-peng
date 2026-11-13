import { App, TFile, TFolder, normalizePath } from 'obsidian';
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
    const folder = vaultPath(value), parts = folder.split('/');
    for (let i = 1; i <= parts.length; i++) {
        const existing = app.vault.getAbstractFileByPath(parts.slice(0, i).join('/'));
        if (existing && !(existing instanceof TFolder)) throw new Error('A file occupies the folder path.');
    }
    if (!checkScope) return folder;
    const under = (path: string, parent: string) => path === parent || path.startsWith(parent + '/');
    if (settings.indexScope === 'folder' && under(settings.attachmentsFolder, folder)) throw new Error('Index notes folder must not contain the attachment scope.');
    const scope = { ...settings, libraryFolder: '' };
    if (settings.indexScope === 'vault' && app.vault.getFiles().some(file => under(file.path, folder) && isEligiblePath(file.path, scope))) throw new Error('This folder contains attachments that would be excluded. Choose another folder.');
    return folder;
}
export function existingBase(app: App, value: string): TFile {
    const path = vaultPath(value), file = app.vault.getFileByPath(path);
    if (!file || file.extension.toLowerCase() !== 'base') throw new Error('Choose an existing .base file.');
    return file;
}
