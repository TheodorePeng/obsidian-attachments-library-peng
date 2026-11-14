/* eslint-disable obsidianmd/ui/sentence-case -- Keep is a named property. */
import { App, Modal, Setting } from 'obsidian';
import { BlockCode, DeletePlan, DeleteReview } from './deletions';
import { ReferenceOccurrence } from './references';
import { confirmAction } from './dialogs';
function fileLink(app: App, parent: HTMLElement, path: string, label = path, line?: number): void {
    const link = parent.createEl('a', { text: label, cls: 'alp-reference-link', attr: { href: path } });
    link.addEventListener('click', event => { event.preventDefault(); void app.workspace.openLinkText(path, '', true, line === undefined ? undefined : { eState: { line: line - 1 } }); });
}
function sourceLink(app: App, parent: HTMLElement, occurrence: ReferenceOccurrence): void {
    const locations = [occurrence.line && 'line ' + occurrence.line, occurrence.property && 'property ' + occurrence.property, occurrence.nodeId && 'node ' + occurrence.nodeId, occurrence.formula && 'formula ' + occurrence.formula].filter(Boolean);
    fileLink(app, parent, occurrence.sourcePath, occurrence.sourcePath + (locations.length ? ' · ' + locations.join(' / ') : ''), occurrence.line);
}
const messages: Record<BlockCode, string> = {
    keep: '“Keep” is turned on for its index note. Turn it off before deleting.',
    'invalid-keep': 'The Keep settings are invalid or disagree. Open the index and fix them before deleting.',
    pending: 'Save or cancel the pending index edit before deleting.',
    conflict: 'The index has conflicting information. Open it and resolve the conflict before deleting.',
    'missing-index': 'A unique index could not be found. Check the attachment association.',
    references: 'References could not be checked completely. Review the details and recheck.',
    'index-used': 'Another document links to this index. Remove that link before deleting the index.',
    scope: 'This attachment is outside the selected attachment scope.',
    desktop: 'Deleting with recovery requires the desktop app.',
    unsupported: 'Some references cannot be safely removed automatically. Review the sources and recheck.',
    editor: 'Save the affected documents before deleting. If a Canvas cannot be checked, save and close it.',
    unknown: 'This item cannot be deleted yet. Review the details and recheck.',
};
export function renderReview(app: App, parent: HTMLElement, review: DeleteReview): void {
    const item = parent.createDiv({ cls: 'alp-delete-item' });
    item.createEl('h3', { text: review.assetPath.split('/').pop() ?? review.assetPath });
    if (review.blockedReason) {
        item.createEl('p', { text: "Can't delete this attachment", cls: 'alp-delete-blocked' });
        item.createEl('p', { text: messages[review.blockCode ?? 'unknown'] });
    }
    const details = item.createEl('details'); details.createEl('summary', { text: 'Files and reference details' });
    details.createEl('p', { text: 'Attachment' }); fileLink(app, details, review.assetPath);
    details.createEl('p', { text: 'Index notes: ' + review.indexPaths.length }); review.indexPaths.forEach(path => fileLink(app, details, path));
    if (review.hasUserBody) details.createEl('p', { text: 'The index contains text. It will also be moved to trash.' });
    if (review.blockedReason) details.createEl('p', { text: review.blockedReason });
    const usage = review.usage; if (!usage) return;
    details.createEl('p', { text: `Referenced by ${usage.count} document(s).` });
    const occurrences = details.createDiv(); let shown = 0;
    const more = details.createEl('button', { text: 'Show next 20 references' });
    const page = () => { usage.occurrences.slice(shown, shown + 20).forEach(occurrence => sourceLink(app, occurrences, occurrence)); shown += 20; more.hidden = shown >= usage.occurrences.length; };
    more.addEventListener('click', page); page();
    details.createEl('p', { text: `Reference check: attachment ${usage.assetCheckComplete ? 'complete' : 'incomplete'}; index ${usage.indexCheckComplete ? 'complete' : 'incomplete'}.` });
    usage.issues.slice(0, 20).forEach(issue => { const p = details.createEl('p', { text: issue.reason }); fileLink(app, p, issue.sourcePath, 'Open source'); });
    if (usage.issues.length > 20) details.createEl('p', { text: (usage.issues.length - 20) + ' more diagnostic groups.' });
    const excluded = details.createEl('details'); excluded.createEl('summary', { text: 'Automatic links not counted as references' });
    usage.excluded.forEach(occurrence => sourceLink(app, excluded, occurrence));
}
export function confirmDeletion(app: App, plan: DeletePlan, recheck?: () => Promise<DeletePlan>, turnOffKeep?: (path: string, assetPath: string) => Promise<void>): Promise<boolean> {
    const origin = typeof activeDocument !== 'undefined' ? activeDocument.activeElement as HTMLElement | null : null;
    return new Promise(resolve => {
        let settled = false;
        class Preview extends Modal {
            private busy = false;
            close(): void { if (!this.busy) super.close(); }
            onOpen(): void { this.draw(); }
            draw(): void {
                this.contentEl.empty(); this.titleEl.setText(plan.mode === 'pair' ? 'Delete attachment and index' : 'Delete index only');
                const blocked = !!plan.skipped.length || !plan.targets.length;
                this.contentEl.createEl('p', { text: blocked ? 'Some items cannot be deleted yet. Review the reasons below.' : 'Review the files and references below. A recovery backup will be created before files are moved to trash.' });
                const list = this.contentEl.createDiv({ cls: 'alp-confirm-list' });
                for (const review of plan.reviews) {
                    const section = list.createDiv(); renderReview(app, section, review);
                    if (review.blockCode === 'keep' && review.indexPaths.length === 1) {
                        const path = review.indexPaths[0];
                        const row = section.createDiv({ cls: 'alp-card-actions' });
                        fileLink(app, row, path, 'Open index');
                        const unlock = row.createEl('button', { text: 'Turn off Keep…' }); unlock.disabled = !turnOffKeep || !recheck;
                        unlock.addEventListener('click', () => { void (async () => {
                            if (this.busy || !turnOffKeep || !recheck) return; this.busy = true; unlock.disabled = true;
                            try {
                                if (!await confirmAction(app, 'Turn off Keep?', ['This changes the Keep setting in ' + path + '. Nothing will be deleted until you confirm deletion separately.'], 'Turn off Keep')) return;
                                await turnOffKeep(path, review.assetPath); Object.assign(plan, await recheck()); this.draw();
                            } catch (error) { const message = section.createEl('p', { text: error instanceof Error ? error.message : 'Could not change Keep.', attr: { role: 'alert' } }); message.addClass('alp-delete-blocked'); }
                            finally { this.busy = false; unlock.disabled = false; }
                        })(); });
                    }
                }
                for (const skipped of plan.skipped) if (!plan.reviews.some(review => review.assetPath === skipped.path || review.indexPaths.includes(skipped.path))) {
                    const item = list.createEl('p', { text: messages[skipped.code ?? 'unknown'], cls: 'alp-delete-blocked' });
                    const details = list.createEl('details'); details.createEl('summary', { text: 'Details' }); details.createEl('p', { text: skipped.path + ': ' + skipped.reason }); item.setAttribute('role', 'alert');
                }
                if (plan.targets.length) { list.createEl('h3', { text: 'Move to trash' }); plan.targets.forEach(target => target.files.forEach(file => fileLink(app, list, file.path))); }
                if (plan.changes?.length) {
                    list.createEl('h3', { text: 'Update references' });
                    for (const change of plan.changes) { fileLink(app, list, change.path); list.createEl('p', { text: change.summary }); const preview = list.createEl('details'); preview.createEl('summary', { text: 'Preview document changes' }); preview.createEl('pre', { text: 'BEFORE\n' + change.before + '\nAFTER\n' + change.after }); }
                }
                new Setting(this.contentEl)
                    .addButton(button => { button.setButtonText('Cancel').onClick(() => { if (!this.busy) this.close(); }); button.buttonEl?.focus(); })
                    .addButton(button => button.setButtonText('Recheck').setDisabled(!recheck).onClick(async () => {
                        if (!recheck || this.busy) return; this.busy = true; button.setDisabled(true);
                        try { Object.assign(plan, await recheck()); this.draw(); } catch(e) { list.createEl('p', { text: String(e), attr: { role: 'alert' } }); button.setDisabled(false); } finally { this.busy = false; }
                    }))
                    .addButton(button => button.setButtonText(plan.changes?.length ? 'Remove references and move to trash' : 'Move to trash').setCta().setDisabled(blocked).onClick(() => { if (blocked || this.busy) return; settled = true; resolve(true); this.close(); }));
            }
            onClose(): void { this.contentEl.empty(); origin?.focus(); if (!settled) resolve(false); }
        }
        new Preview(app).open();
    });
}
export function showReferenceDetails(app: App, review: DeleteReview): void {
    class Details extends Modal {
        onOpen(): void { this.titleEl.setText('Attachment references'); renderReview(app, this.contentEl, review); }
        onClose(): void { this.contentEl.empty(); }
    }
    new Details(app).open();
}
