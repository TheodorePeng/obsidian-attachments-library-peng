/* eslint-disable import/no-nodejs-modules, @typescript-eslint/no-require-imports */
import { App, Platform } from 'obsidian';
import { fingerprint, OperationStore } from './operation-store';
import { vaultPath } from './paths';
export interface RecoveryFile { path: string; before: string; after?: string; binary: boolean; beforeHash?: string; afterHash?: string; }
export interface Journal { id: string; vault: string; phase: string; created?: number; files: RecoveryFile[]; error?: string; }
/** Binary contents are base64. Atomic journal replacement records intent before every mutation. */
export class DeletionRecovery extends OperationStore {
    issues: string[] = [];
    available(): boolean { return Platform.isDesktopApp; }
    private location(): string {
        const nodePath = require('path') as typeof import('path');
        const { homedir } = require('os') as typeof import('os');
        return this.root ?? nodePath.join(homedir(), '.local/share/attachments-library-peng/backups');
    }
    private async atomic(path: string, journal: Journal): Promise<void> {
        const fs = require('fs/promises') as typeof import('fs/promises');
        const next = path + '.next';
        const handle = await fs.open(next, 'w', 0o600);
        try { await handle.writeFile(JSON.stringify(journal)); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(next, path);
        const directory = await fs.open((require('path') as typeof import('path')).dirname(path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    }
    async begin(vault: string, files: RecoveryFile[]): Promise<Journal> {
        if (!this.available()) throw new Error('Recoverable deletion requires the desktop app.');
        const { mkdir } = require('fs/promises') as typeof import('fs/promises');
        const nodePath = require('path') as typeof import('path');
        const crypto = require('crypto') as typeof import('crypto');
        const journal: Journal = { id: crypto.randomUUID(), vault, phase: 'prepared', created: Date.now(), files: files.map(file => ({ ...file, beforeHash: fingerprint(file.before), afterHash: file.after === undefined ? undefined : fingerprint(file.after) })) };
        const directory = nodePath.join(this.location(), journal.id);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await this.atomic(nodePath.join(directory, 'transaction.json'), journal);
        this.lastReport = directory;
        return journal;
    }
    async phase(journal: Journal, phase: string, error?: string): Promise<void> {
        journal.phase = phase; journal.error = error;
        await this.atomic((require('path') as typeof import('path')).join(this.location(), journal.id, 'transaction.json'), journal);
    }
    async list(vault: string): Promise<Journal[]> {
        this.issues = [];
        if (!this.available()) return [];
        const fs = require('fs/promises') as typeof import('fs/promises'), nodePath = require('path') as typeof import('path');
        let entries: string[]; try { entries = await fs.readdir(this.location()); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
        const results: Journal[] = [];
        for (const name of entries) {
            if (!/^[a-f\d-]{36}$/.test(name)) continue;
            try { const value = JSON.parse(await fs.readFile(nodePath.join(this.location(), name, 'transaction.json'), 'utf8')) as Journal; if (value.vault === vault && value.id === name) results.push(value); }
            catch { this.issues.push('Unreadable recovery record: ' + name); }
        }
        return results.sort((a,b) => (b.created ?? 0) - (a.created ?? 0));
    }
    async restore(app: App, journal: Journal): Promise<string[]> {
        const conflicts: string[] = [];
        // Verify *all* paths and backups before the first write; originals are restored before references.
        if (journal.vault !== recoveryVault(app)) throw new Error('Recovery belongs to a different Vault.');
        for (const entry of journal.files) {
            if (vaultPath(entry.path) !== entry.path) throw new Error('Invalid recovery path');
            if (entry.beforeHash !== fingerprint(entry.before) || entry.after !== undefined && entry.afterHash !== fingerprint(entry.after)) throw new Error('Recovery backup integrity check failed: ' + entry.path);
        }
        for (const entry of [...journal.files].sort((a,b) => Number(a.after !== undefined) - Number(b.after !== undefined))) {
            try {
                const current = app.vault.getFileByPath(entry.path);
                if (entry.after === undefined) {
                    if (current) { const bytes = await app.vault.readBinary(current); if (Buffer.from(bytes).toString('base64') !== entry.before) throw new Error('Path occupied'); }
                    else {
                        const parts = entry.path.split('/').slice(0,-1);
                        for (let i=1;i<=parts.length;i++) { const path = parts.slice(0,i).join('/'); if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path); }
                        await app.vault.createBinary(entry.path, Uint8Array.from(Buffer.from(entry.before, 'base64')).buffer);
                    }
                } else {
                    if (!current) throw new Error('Source missing');
                    await app.vault.process(current, text => { if (text === entry.before) return text; if (fingerprint(text) !== fingerprint(entry.after!)) throw new Error('Subsequent edits'); return entry.before; });
                }
            } catch (error) { conflicts.push(entry.path + ': ' + (error instanceof Error ? error.message : 'Restore failed')); if (entry.after === undefined) break; }
        }
        await this.phase(journal, conflicts.length ? 'recovery-required' : 'restored', conflicts.join('\n'));
        return conflicts;
    }
}
export function recoveryVault(app: App): string {
    const adapter = app.vault.adapter as unknown as { getBasePath?: () => string };
    return adapter.getBasePath?.() ?? app.vault.getName?.() ?? '(test vault)';
}
