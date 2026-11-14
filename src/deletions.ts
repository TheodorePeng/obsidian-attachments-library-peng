import { DeletionRecovery, Journal, recoveryVault } from './deletion-recovery';
import { SourceChange, planReferenceEdit } from './reference-edits';
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
    changes: SourceChange[];
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
    status: 'complete' | 'partial' | 'aborted' | 'rolled-back' | 'recovery-required';
    recovery?: string;
    steps: DeleteStep[];
    message: string;
}
export class DeletionService {
    readonly logs: DeleteResult[] = [];
    isActive: () => boolean = () => true;
    private issued = new Map<string, string>();
    private identities = new Map<string, Map<string, TFile>>();
    private busy = false;
    private preparing = false;
    private ownedPaths = new Set<string>();
    hasPendingEdits = (_indexPath: string): boolean => false;
    get active(): boolean { return this.busy; }
    async restoreJournal(journal: Journal): Promise<string[]> {
        if (!this.isActive()) throw new Error('Plugin is stopped');
        if (this.busy) throw new Error('Deletion transaction in progress');
        this.busy = true; this.ownedPaths = new Set(journal.files.map(file => file.path));
        try { await this.assertCleanEditors(this.ownedPaths); return await this.recovery.restore(this.app, journal); }
        finally { await this.registry.refresh(true); await this.references.refresh(undefined, false); this.busy = false; this.ownedPaths.clear(); }
    }
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
    constructor(private app: App, private registry: AttachmentRegistry, private references: ReferenceService, public recovery = new DeletionRecovery()) { }
    private async snapshot(overrides?: ReadonlyMap<string, string>): Promise<ReferenceService> {
        const refs = new ReferenceService(this.app, this.registry, true, overrides);
        await refs.refresh(undefined, false);
        return refs;
    }
    private async fingerprint(file: TFile): Promise<Fingerprint> {
        const buffer = await this.app.vault.readBinary(file);
        const hash = Array.from(new Uint8Array(await window.crypto.subtle.digest('SHA-256', buffer))).map(n => n.toString(16).padStart(2, '0')).join('');
        return { path: file.path, mtime: file.stat.mtime, size: file.stat.size, hash };
    }
    private assertAllowed(record: AttachmentRecord, mode: DeleteMode, refs: ReferenceService): void {
        const usage = refs.getUsage(record);
        if ((record.indexPaths ?? []).some(path => this.hasPendingEdits(path))) throw new Error('Index has pending property edits; save or cancel first.');
        if (effectiveKeep(record.metadata)) throw new Error('Protected by keep or legacy al_keep: ' + record.assetPath);
        const issues = managedIssues(record.metadata);
        if (record.conflict || issues.length || usage.state === 'excluded') throw new Error('Protected attachment: ' + record.assetPath + ' — ' + (record.reason || issues.join('; ') || usage.state));
        if (!record.index || !record.indexPath) throw new Error('No unique metadata index: ' + record.assetPath);
        if (!usage.indexCheckComplete || mode === 'pair' && !usage.assetCheckComplete) throw new Error('Reference checks incomplete: ' + usage.reasons.slice(0, 5).join('; '));
        if (mode === 'metadata-only' && usage.indexSources.length) throw new Error('Metadata document is referenced: ' + record.indexPath);
        if (mode === 'pair' && (!record.asset || !isEligiblePath(record.assetPath, this.registry.settings))) throw new Error('Attachment outside cleanup scope: ' + record.assetPath);
    }
    private async assertCleanEditors(paths: ReadonlySet<string>): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file && paths.has(view.file.path) && view.editor.getValue() !== await this.app.vault.read(view.file)) throw new Error('Unsaved editor: ' + view.file.path);
        }
        for (const leaf of this.app.workspace.getLeavesOfType('canvas')) {
            const view = leaf.view as unknown as { file?: TFile; getViewData?: () => string };
            if (!view.file || !paths.has(view.file.path)) continue;
            if (!view.getViewData) throw new Error('Save and close this Canvas, then recheck: ' + view.file.path);
            let same = false;
            try { same = JSON.stringify(JSON.parse(view.getViewData())) === JSON.stringify(JSON.parse(await this.app.vault.read(view.file))); } catch { /* Native state cannot be proved clean. */ }
            if (!same) throw new Error('Save and close this Canvas, then recheck: ' + view.file.path);
        }
    }
    async prepare(paths: string[], mode: DeleteMode): Promise<DeletePlan> {
        if (!this.isActive()) throw new Error('Plugin is stopped');
        if (this.busy || this.preparing) throw new Error('Deletion transaction in progress');
        this.preparing = true;
        try {
        await this.registry.refresh(true);
        const refs = await this.snapshot(), targets: DeleteTarget[] = [], reviews: DeleteReview[] = [], skipped: DeletePlan['skipped'] = [];
        const seen = new Set<string>();
        for (const path of paths) {
            const record = this.registry.records.get(path) ?? this.registry.byIndex.get(path);
            if (!record) { skipped.push({ path, reason: 'Unknown attachment' }); continue; }
            if (seen.has(record.assetPath)) continue;
            seen.add(record.assetPath);
            const indexPaths = record.indexPaths ?? [], hasUserBody = record.index ? !!(await this.app.vault.read(record.index)).replace(/^---\r?\n[\s\S]*?\r?\n---/, '').replace(/<!-- alp:preview:start -->[\s\S]*?<!-- alp:preview:end -->/g, '').trim() : false;
            const review: DeleteReview = { assetPath: record.assetPath, indexPaths, usage: refs.getUsage(record), hasUserBody }; reviews.push(review);
            try {
                if (!this.recovery.available()) throw new Error('Recoverable deletion requires the desktop app.');
                this.assertAllowed(record, mode, refs);
                const files = mode === 'pair' ? [record.asset!, record.index!] : [record.index!];
                targets.push({ assetPath: record.assetPath, indexPath: record.indexPath!, files: await Promise.all(files.map(file => this.fingerprint(file))), hasUserBody, safetySnapshot: refs.safetySnapshot(record, mode) });
            } catch (error) { review.blockedReason = error instanceof Error ? error.message : 'Protected'; skipped.push({ path, reason: review.blockedReason }); }
        }
        const removedPaths = new Set(targets.flatMap(target => target.files.map(file => file.path))), changes: SourceChange[] = [];
        if (mode === 'pair') {
            const occurrences = reviews.flatMap(review => review.usage?.occurrences ?? []).filter(item => removedPaths.has(item.targetPath));
            const properties = new Map<string, Set<string>>();
            for (const occurrence of occurrences) if (occurrence.originPath && occurrence.property && !removedPaths.has(occurrence.originPath)) {
                const keys = properties.get(occurrence.originPath) ?? new Set<string>(); keys.add(occurrence.property); properties.set(occurrence.originPath, keys);
            }
            const sources = new Set([...reviews.flatMap(review => review.usage?.sources ?? []).filter(path => !removedPaths.has(path) && occurrences.some(item => item.sourcePath === path && !item.originPath)), ...properties.keys()]);
            for (const path of sources) try {
                const file = this.app.vault.getFileByPath(path); if (!file) throw new Error('Source disappeared: ' + path);
                changes.push(planReferenceEdit(this.app, path, await this.app.vault.read(file), removedPaths, properties.get(path)));
            } catch (error) { skipped.push({ path, reason: error instanceof Error ? error.message : 'Unsupported reference' }); }
        }
        if (mode === 'pair' && targets.length && !skipped.length) {
            const projected = await this.snapshot(new Map(changes.map(change => [change.path, change.after])));
            for (const target of targets) {
                const usage = projected.getUsage(this.registry.records.get(target.assetPath)!);
                const remaining = usage.sources.filter(path => !removedPaths.has(path));
                if (remaining.length || !usage.assetCheckComplete || !usage.indexCheckComplete) skipped.push({ path: target.assetPath, reason: 'Some references cannot be safely removed: ' + [...remaining, ...usage.reasons.slice(0, 3)].join('; ') });
            }
        }
        try { await this.assertCleanEditors(new Set([...removedPaths, ...changes.map(change => change.path)])); }
        catch (error) { skipped.push({ path: '(editors)', reason: error instanceof Error ? error.message : 'Unsaved content' }); }
        const plan: DeletePlan = { token: window.crypto.randomUUID(), mode, generation: this.registry.generation, referenceGeneration: refs.generation, targets, skipped, reviews, changes };
        this.issued.set(plan.token, JSON.stringify(plan));
        this.identities.set(plan.token, new Map([...removedPaths, ...changes.map(change => change.path)].map(path => [path, this.app.vault.getFileByPath(path)!])));
        if (this.issued.size > 20) { const oldest = [...this.issued.keys()][0]; this.issued.delete(oldest); this.identities.delete(oldest); }
        return plan;
        } finally { this.preparing = false; }
    }
    private async verify(plan: DeletePlan, refs: ReferenceService, referencesRemoved = false): Promise<void> {
        for (const target of plan.targets) {
            const record = this.registry.records.get(target.assetPath);
            if (!record || record.indexPath !== target.indexPath) throw new Error('Association changed; preview again.');
            this.assertAllowed(record, plan.mode, refs);
            if (!referencesRemoved && target.safetySnapshot !== refs.safetySnapshot(record, plan.mode)) throw new Error('Relevant references changed; preview again.');
            if (referencesRemoved && plan.mode === 'pair') {
                const removed = new Set(plan.targets.flatMap(item => item.files.map(file => file.path)));
                if (refs.getUsage(record).sources.some(path => !removed.has(path))) throw new Error('Business references remain; stopped before trash.');
            }
            for (const expected of target.files) {
                const file = this.app.vault.getFileByPath(expected.path);
                if (!file || JSON.stringify(await this.fingerprint(file)) !== JSON.stringify(expected)) throw new Error('File changed: ' + expected.path);
            }
        }
    }
    async execute(plan: DeletePlan): Promise<DeleteResult> {
        const steps: DeleteStep[] = [];
        if (!this.isActive() || this.busy || this.issued.get(plan.token) !== JSON.stringify(plan)) return { status: 'aborted', steps, message: 'Expired, changed or already consumed plan' };
        if (!plan.targets.length || plan.skipped.length) return { status: 'aborted', steps, message: 'Resolve protected items and preview again. No files changed.' };
        this.busy = true; this.issued.delete(plan.token);
        const identities = this.identities.get(plan.token)!; this.identities.delete(plan.token);
        this.ownedPaths = new Set([...plan.targets.flatMap(target => target.files.map(file => file.path)), ...plan.changes.map(change => change.path)]);
        let journal: Journal | undefined, mutated = false;
        try {
            await this.assertCleanEditors(this.ownedPaths);
            for (const [path, file] of identities) if (this.app.vault.getFileByPath(path) !== file) throw new Error('File identity changed: ' + path);
            await this.registry.refresh(true); await this.verify(plan, await this.snapshot());
            for (const change of plan.changes) if (await this.app.vault.read(this.app.vault.getFileByPath(change.path)!) !== change.before) throw new Error('Source changed: ' + change.path);
            const files: import('./deletion-recovery').RecoveryFile[] = [];
            for (const target of plan.targets) for (const expected of target.files) files.push({ path: expected.path, before: Buffer.from(await this.app.vault.readBinary(this.app.vault.getFileByPath(expected.path)!)).toString('base64'), binary: true });
            journal = await this.recovery.begin(recoveryVault(this.app), [...files, ...plan.changes.map(change => ({ path: change.path, before: change.before, after: change.after, binary: false }))]);
            if (!await this.persistLog({ status: 'aborted', steps: [], message: 'Prepared recovery transaction.' }, plan)) throw new Error('Cannot persist transaction log');
            await this.recovery.phase(journal, 'editing');
            for (const change of plan.changes) {
                if (!this.isActive()) throw new Error('Plugin stopped');
                await this.assertCleanEditors(this.ownedPaths);
                const file = this.app.vault.getFileByPath(change.path); if (!file || identities.get(change.path) !== file) throw new Error('Source identity changed');
                await this.app.vault.process(file, current => { if (current !== change.before) throw new Error('Source changed: ' + change.path); return change.after; }); mutated = true;
            }
            await this.registry.refresh(true); await this.verify(plan, await this.snapshot(), true);
            await this.recovery.phase(journal, 'trashing');
            for (const target of plan.targets) for (const expected of target.files) {
                if (!this.isActive()) throw new Error('Plugin stopped');
                await this.assertCleanEditors(this.ownedPaths);
                // A fresh source snapshot detects newly introduced references between trash steps.
                const refs = await this.snapshot();
                const current = this.registry.records.get(target.assetPath)!;
                const usage = refs.getUsage(current), removed = new Set(plan.targets.flatMap(item => item.files.map(file => file.path)));
                if (plan.mode === 'pair' && (!usage.assetCheckComplete || !usage.indexCheckComplete || usage.sources.some(path => !removed.has(path)))) throw new Error('References changed during transaction');
                const index = this.app.vault.getFileByPath(target.indexPath), expectedIndex = target.files.find(file => file.path === target.indexPath)!;
                if (this.hasPendingEdits(target.indexPath) || !index || identities.get(target.indexPath) !== index || JSON.stringify(await this.fingerprint(index)) !== JSON.stringify(expectedIndex)) throw new Error('Index changed or has pending edits before trash: ' + target.indexPath);
                if (plan.mode === 'pair' && !isEligiblePath(target.assetPath, this.registry.settings)) throw new Error('Attachment scope changed during transaction');
                const file = this.app.vault.getFileByPath(expected.path);
                if (!file || identities.get(expected.path) !== file || JSON.stringify(await this.fingerprint(file)) !== JSON.stringify(expected)) throw new Error('File changed before trash: ' + expected.path);
                // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- Explicit recoverable local trash; never follow a permanent-delete preference.
                try { await this.app.vault.trash(file, false); mutated = true; }
                catch (error) { steps.push({ path: expected.path, step: expected.path === target.assetPath ? 'asset' : 'index', status: 'failed', recovery: this.recovery.lastReport }); throw error; }
                steps.push({ path: expected.path, step: expected.path === target.assetPath ? 'asset' : 'index', status: 'trashed', recovery: this.recovery.lastReport });
                await this.recovery.phase(journal, 'trashing');
                if (!await this.persistLog({ status: 'partial', steps: [...steps], message: 'Transaction in progress.' }, plan)) throw new Error('Cannot persist transaction progress');
            }
            if (plan.targets.some(target => target.files.some(file => this.app.vault.getAbstractFileByPath(file.path)))) throw new Error('Trash verification failed');
            if (plan.mode === 'pair') {
                const finalRefs = await this.snapshot();
                for (const target of plan.targets) { const usage = finalRefs.getUsage(this.registry.records.get(target.assetPath)!); if (usage.sources.length || !usage.assetCheckComplete || !usage.indexCheckComplete) throw new Error('Final reference verification failed'); }
            }
            await this.recovery.phase(journal, 'complete');
            const result: DeleteResult = { status: 'complete', steps, recovery: this.recovery.lastReport, message: 'References cleared. Files moved to local .trash. Recovery backup: ' + this.recovery.lastReport };
            this.logs.push(result); await this.persistLog(result, plan); return result;
        } catch (error) {
            let status: DeleteResult['status'] = 'aborted', message = error instanceof Error ? error.message : 'Operation failed';
            if (journal) {
                try {
                    const conflicts = mutated ? await this.recovery.restore(this.app, journal) : (await this.recovery.phase(journal, 'not-executed'), []);
                    status = conflicts.length ? 'recovery-required' : mutated ? 'rolled-back' : 'aborted';
                    if (conflicts.length) message += '\nRecovery required: ' + conflicts.join('\n');
                } catch (restoreError) { status = 'recovery-required'; message += '\nRecovery required: ' + String(restoreError); }
            }
            const result: DeleteResult = { status, steps, recovery: journal ? this.recovery.lastReport : undefined, message };
            this.logs.push(result); await this.persistLog(result, plan); return result;
        } finally {
            try { await this.registry.refresh(true); await this.references.refresh(undefined, false); }
            catch (error) { const result = this.logs[this.logs.length - 1]; if (result) result.message += '\nIndex refresh pending: ' + String(error); }
            finally { this.busy = false; this.ownedPaths.clear(); }
        }
    }
}
