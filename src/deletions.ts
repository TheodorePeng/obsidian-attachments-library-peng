import { App, MarkdownView, TFile } from 'obsidian';
import { AttachmentRegistry, AttachmentRecord } from './registry';
import { ReferenceService } from './references';
import { isEligiblePath } from './file-policy';
export type DeleteMode = 'metadata-only' | 'pair';
interface Fingerprint {
    path: string;
    mtime: number;
    size: number;
    hash: string;
}
export interface DeleteTarget {
    assetPath: string;
    indexPath: string;
    files: Fingerprint[];
    hasUserBody: boolean;
}
export interface DeletePlan {
    token: string;
    mode: DeleteMode;
    generation: number;
    referenceGeneration: number;
    targets: DeleteTarget[];
    skipped: {
        path: string;
        reason: string;
    }[];
}
export interface DeleteStep {
    path: string;
    step: 'asset' | 'index';
    status: 'trashed' | 'failed';
    recovery: string;
}
export interface DeleteResult {
    status: 'complete' | 'partial' | 'aborted';
    steps: DeleteStep[];
    message: string;
}
export class DeletionService {
    readonly logs: DeleteResult[] = [];
    isActive: () => boolean = () => true;
    private issued = new Map<string, string>();
    private busy = false;
    private async persistLog(result: DeleteResult, plan: DeletePlan): Promise<boolean> {
        const root = this.app.vault.configDir + '/plugins/attachments-library-peng';
        const adapter = this.app.vault.adapter;
        try {
            if (!await adapter.exists(root))
                await adapter.mkdir(root);
            const path = root + '/deletion-log.json';
            let entries: unknown[] = [];
            if (await adapter.exists(path)) {
                try {
                    const previous: unknown = JSON.parse(await adapter.read(path));
                    if (Array.isArray(previous))
                        entries = previous;
                }
                catch { /* Preserve a corrupt log before starting a replacement. */
                    await adapter.write(path + '.corrupt-' + Date.now(), await adapter.read(path));
                }
            }
            entries.push({ transactionId: plan.token, time: new Date().toISOString(), mode: plan.mode, targets: plan.targets.map(t => ({ assetPath: t.assetPath, indexPath: t.indexPath })), skipped: plan.skipped, recoveryDirectory: '.trash', ...result });
            await adapter.write(path, JSON.stringify(entries, null, 2));
            return true;
        }
        catch {
            result.message += ' Operation log could not be persisted; keep this result for recovery.';
            return false;
        }
    }
    constructor(private app: App, private registry: AttachmentRegistry, private references: ReferenceService) { }
    private async fingerprint(file: TFile): Promise<Fingerprint> {
        const buffer = await this.app.vault.readBinary(file);
        const hash = Array.from(new Uint8Array(await window.crypto.subtle.digest('SHA-256', buffer))).map(n => n.toString(16).padStart(2, '0')).join('');
        return { path: file.path, mtime: file.stat.mtime, size: file.stat.size, hash };
    }
    private assertAllowed(record: AttachmentRecord, mode: DeleteMode): void {
        const usage = this.references.getUsage(record);
        if (record.conflict || record.metadata.al_keep === true || usage.state === 'unknown' || usage.state === 'excluded')
            throw new Error('Protected attachment: ' + record.assetPath + ' (' + usage.state + ')');
        if (!record.index || !record.indexPath)
            throw new Error('No unique metadata index: ' + record.assetPath);
        if (usage.indexSources.length)
            throw new Error('Metadata document is referenced: ' + record.indexPath);
        if (mode === 'pair' && (usage.count > 0 || !record.asset || !isEligiblePath(record.assetPath, this.registry.settings)))
            throw new Error('Attachment is used or outside cleanup scope: ' + record.assetPath);
    }
    private async assertCleanEditors(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file && view.editor.getValue() !== await this.app.vault.cachedRead(view.file))
                throw new Error('Unsaved editor: ' + view.file.path);
        }
    }
    async prepare(paths: string[], mode: DeleteMode): Promise<DeletePlan> {
        if (!this.isActive())
            throw new Error('Plugin is stopped');
        if (this.busy)
            throw new Error('Deletion transaction in progress');
        await this.assertCleanEditors();
        await this.registry.refresh();
        await this.references.refresh();
        const targets: DeleteTarget[] = [];
        const skipped: {
            path: string;
            reason: string;
        }[] = [];
        const seen = new Set<string>();
        for (const path of paths) {
            const record = this.registry.records.get(path) ?? this.registry.byIndex.get(path);
            if (!record) {
                skipped.push({ path, reason: 'Unknown attachment' });
                continue;
            }
            if (seen.has(record.assetPath))
                continue;
            seen.add(record.assetPath);
            try {
                this.assertAllowed(record, mode);
            }
            catch (error) {
                skipped.push({ path, reason: error instanceof Error ? error.message : 'Protected' });
                continue;
            }
            const index = record.index!;
            const files = mode === 'pair' ? [record.asset!, index] : [index];
            const body = await this.app.vault.cachedRead(index);
            targets.push({ assetPath: record.assetPath, indexPath: index.path, files: await Promise.all(files.map(file => this.fingerprint(file))), hasUserBody: !!body.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').replace(/<!-- alp:preview:start -->[\s\S]*?<!-- alp:preview:end -->/g, '').trim() });
        }
        if (!targets.length)
            throw new Error(skipped.map(s => s.path + ': ' + s.reason).join('\n') || 'Select at least one attachment');
        const plan: DeletePlan = { token: window.crypto.randomUUID(), mode, generation: this.registry.generation, referenceGeneration: this.references.generation, targets, skipped };
        this.issued.set(plan.token, JSON.stringify(plan));
        return plan;
    }
    async execute(plan: DeletePlan): Promise<DeleteResult> {
        const steps: DeleteStep[] = [];
        if (!this.isActive() || this.busy || this.issued.get(plan.token) !== JSON.stringify(plan))
            return { status: 'aborted', steps, message: 'Expired, changed or already consumed plan' };
        this.busy = true;
        this.issued.delete(plan.token);
        try {
            await this.assertCleanEditors();
            await this.registry.refresh();
            await this.references.refresh();
            if (plan.generation !== this.registry.generation || plan.referenceGeneration !== this.references.generation)
                throw new Error('References or associations changed; preview again');
            for (const target of plan.targets) {
                const record = this.registry.records.get(target.assetPath);
                if (!record || record.indexPath !== target.indexPath)
                    throw new Error('Association changed');
                this.assertAllowed(record, plan.mode);
                for (const fingerprint of target.files) {
                    const file = this.app.vault.getFileByPath(fingerprint.path);
                    if (!file || JSON.stringify(await this.fingerprint(file)) !== JSON.stringify(fingerprint))
                        throw new Error('File changed: ' + fingerprint.path);
                }
            }
            if (!await this.persistLog({ status: 'aborted', steps: [], message: 'Prepared transaction; no automatic resume.' }, plan))
                throw new Error('Cannot persist transaction log; deletion stopped');
            for (const target of plan.targets) {
                if (!this.isActive())
                    throw new Error('Plugin is stopped');
                await this.assertCleanEditors();
                await this.registry.refresh();
                await this.references.refresh();
                const current = this.registry.records.get(target.assetPath);
                if (!current || current.indexPath !== target.indexPath)
                    throw new Error('Association changed during transaction');
                this.assertAllowed(current, plan.mode);
                for (const fingerprint of target.files) {
                    const file = this.app.vault.getFileByPath(fingerprint.path);
                    if (!file || JSON.stringify(await this.fingerprint(file)) !== JSON.stringify(fingerprint))
                        throw new Error('File changed during transaction: ' + fingerprint.path);
                }
                for (const fingerprint of target.files) {
                    const step = fingerprint.path === target.assetPath ? 'asset' : 'index';
                    if (!this.isActive())
                        throw new Error('Plugin is stopped');
                    try {
                        await this.app.vault.trash(this.app.vault.getFileByPath(fingerprint.path)!, false);
                    }
                    catch {
                        steps.push({ path: fingerprint.path, step, status: 'failed', recovery: 'Original path: ' + fingerprint.path });
                        const result: DeleteResult = { status: 'partial', steps, message: 'Stopped after failure; no automatic retry. Restore trashed paths from the Vault .trash folder.' };
                        this.logs.push(result);
                        await this.persistLog(result, plan);
                        return result;
                    }
                    steps.push({ path: fingerprint.path, step, status: 'trashed', recovery: '.trash (original: ' + fingerprint.path + ')' });
                    if (!await this.persistLog({ status: 'partial', steps: [...steps], message: 'Transaction in progress; no automatic resume.' }, plan))
                        throw new Error('Cannot persist transaction progress');
                }
            }
            const result: DeleteResult = { status: 'complete', steps, message: 'Moved to Vault .trash; original paths recorded.' };
            this.logs.push(result);
            await this.persistLog(result, plan);
            return result;
        }
        catch (error) {
            const result: DeleteResult = { status: steps.length ? 'partial' : 'aborted', steps, message: error instanceof Error ? error.message : 'Preflight failed' };
            this.logs.push(result);
            await this.persistLog(result, plan);
            return result;
        }
        finally {
            this.busy = false;
            await this.registry.refresh();
            await this.references.refresh();
        }
    }
}
