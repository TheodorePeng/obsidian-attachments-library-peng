/* Desktop-only recovery operations load Node lazily so mobile plugin startup stays usable. */
/* eslint-disable import/no-nodejs-modules, @typescript-eslint/no-require-imports */
import { App, MarkdownView, TFile } from 'obsidian';
export function fingerprint(text: string): string {
    const { createHash } = require('crypto') as typeof import('crypto');
    return createHash('sha256').update(text).digest('hex');
}
/** Persistent, private backups outside the synced Vault. No direct writes to types.json. */
export class OperationStore {
    lastReport = '';
    context = '';
    constructor(private root?: string) {}
    async save(kind: string, files: { path: string; content: string }[], details: unknown): Promise<string> {
        const { mkdir, writeFile } = require('fs/promises') as typeof import('fs/promises');
        const { join } = require('path') as typeof import('path');
        const { homedir } = require('os') as typeof import('os');
        const { randomUUID } = require('crypto') as typeof import('crypto');
        const root = this.root ?? join(homedir(), '.local/share/attachments-library-peng/backups');
        const directory = join(root, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const manifest: { path: string; backup: string; sha256: string }[] = [];
        for (const [i, file] of files.entries()) {
            const name = i + '.backup';
            await writeFile(join(directory, name), file.content, { mode: 0o600 });
            manifest.push({ path: file.path, backup: name, sha256: fingerprint(file.content) });
        }
        await writeFile(join(directory, 'report.json'), JSON.stringify({ kind, vault: this.context, files: manifest, details }, null, 2), { mode: 0o600 });
        this.lastReport = directory;
        return directory;
    }
}
export async function assertSaved(app: App, file: TFile, blocked: (path: string) => boolean): Promise<void> {
    if (blocked(file.path)) throw new Error('Index has a pending edit or deletion: ' + file.path);
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.editor.getValue() !== await app.vault.read(file)) throw new Error('Unsaved Markdown edits: ' + file.path);
    }
}
