import { effectiveKeep, managedIssues } from './managed-properties';
import { App, MarkdownView, TFile } from 'obsidian';
import { AttachmentRegistry, AttachmentRecord } from './registry';
import { ReferenceService, Usage } from './references';
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
    safetySnapshot: string;
}
export interface DeleteReview {
    assetPath: string;
    indexPaths: string[];
    usage?: Usage;
    blockedReason?: string;
    hasUserBody: boolean;
}
export interface DeletePlan {
    token: string;
    mode: DeleteMode;
    generation: number;
    referenceGeneration: number;
    targets: DeleteTarget[];
    reviews: DeleteReview[];
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
    private ownedPaths = new Set<string>();
    hasPendingEdits = (_indexPath: string): boolean => false;
    ownsPath(path: string): boolean { return this.ownedPaths.has(path); }
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
        if ((record.indexPaths ?? (record.indexPath ? [record.indexPath] : [])).some(path => this.hasPendingEdits(path))) throw new Error('索引有未提交的卡片属性编辑，请先保存或取消');
        if (effectiveKeep(record.metadata)) throw new Error('Protected by keep or legacy al_keep: ' + record.assetPath);
        const propertyIssues = managedIssues(record.metadata);
        if (record.conflict || propertyIssues.length > 0 || usage.state === 'excluded')
            throw new Error('Protected attachment: ' + record.assetPath + ' — ' + (record.reason || propertyIssues.join('; ') || usage.state));
        if (!record.index || !record.indexPath)
            throw new Error('No unique metadata index: ' + record.assetPath);
        if (!usage.indexCheckComplete || (mode === 'pair' && !usage.assetCheckComplete))
            throw new Error('Reference checks incomplete: ' + usage.reasons.join('; '));
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
        const reviews: DeleteReview[] = [];
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
            const indexPaths = record.indexPaths ?? (record.indexPath ? [record.indexPath] : []);
            const hasUserBody = record.index ? !!(await this.app.vault.cachedRead(record.index)).replace(/^---\r?\n[\s\S]*?\r?\n---/, '').replace(/<!-- alp:preview:start -->[\s\S]*?<!-- alp:preview:end -->/g, '').trim() : false;
            const review: DeleteReview = { assetPath: record.assetPath, indexPaths, usage: this.references.getUsage(record), hasUserBody };
            reviews.push(review);
            try {
                this.assertAllowed(record, mode);
            }
            catch (error) {
                review.blockedReason = error instanceof Error ? error.message : 'Protected';
                skipped.push({ path, reason: review.blockedReason });
                continue;
            }
            const index = record.index!;
            const files = mode === 'pair' ? [record.asset!, index] : [index];
            targets.push({ assetPath: record.assetPath, indexPath: index.path, files: await Promise.all(files.map(file => this.fingerprint(file))), hasUserBody, safetySnapshot: this.references.safetySnapshot(record, mode) });
        }
        const plan: DeletePlan = { token: window.crypto.randomUUID(), mode, generation: this.registry.generation, referenceGeneration: this.references.generation, targets, skipped, reviews };
        this.issued.set(plan.token, JSON.stringify(plan));
        return plan;
    }
    async execute(plan: DeletePlan): Promise<DeleteResult> {
        const steps: DeleteStep[] = [];
        if (!this.isActive() || this.busy || this.issued.get(plan.token) !== JSON.stringify(plan))
            return { status: 'aborted', steps, message: 'Expired, changed or already consumed plan' };
        if (!plan.targets.length) return { status: 'aborted', steps, message: 'No eligible files. Review protected items.' };
        this.busy = true;
        this.ownedPaths = new Set(plan.targets.flatMap(target => [target.assetPath, target.indexPath]));
        this.issued.delete(plan.token);
        try {
            await this.assertCleanEditors();
            await this.registry.refresh();
            await this.references.refresh();
            for (const target of plan.targets) {
                const record = this.registry.records.get(target.assetPath);
                if (!record || record.indexPath !== target.indexPath)
                    throw new Error('Association changed');
                this.assertAllowed(record, plan.mode);
                if (target.safetySnapshot !== this.references.safetySnapshot(record, plan.mode)) throw new Error('Relevant references or associations changed; preview again');
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
                if (target.safetySnapshot !== this.references.safetySnapshot(current, plan.mode)) throw new Error('Relevant references changed during transaction');
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
                        const file = this.app.vault.getFileByPath(fingerprint.path);
                        if (!file || JSON.stringify(await this.fingerprint(file)) !== JSON.stringify(fingerprint)) throw new Error('File changed before trash: ' + fingerprint.path);
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
            this.ownedPaths.clear();
            await this.registry.refresh();
            await this.references.refresh();
        }
    }
}
