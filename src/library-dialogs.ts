/* eslint-disable obsidianmd/ui/sentence-case -- Base, Vault and OCR are product/API nouns. */
import { App, Modal } from 'obsidian';
import type AttachmentsLibraryPlugin from './main';
import { LibraryRestore, LibraryDiscovery } from './library-restore';
import { confirmAction } from './dialogs';
import { recoveryVault } from './deletion-recovery';
export function restoreLibraryDialog(app: App, plugin: AttachmentsLibraryPlugin): void {
    const service = new LibraryRestore(app, plugin.registry, plugin.store);
    service.isActive = () => plugin.isRunning();
    service.blocked = path => plugin.deletions.ownsPath(path) || plugin.propertyEdits.hasPending(path);
    class Restore extends Modal {
        private closed = false;
        private message = '';
        onOpen(): void { this.titleEl.setText('Restore existing library'); this.contentEl.setText('Discovering existing documents…'); void this.load(); }
        async load(): Promise<void> {
            try { const result = await service.discover(); if (!this.closed) this.show(result); }
            catch (e) { if (!this.closed) this.contentEl.setText(String(e)); }
        }
        show(result: LibraryDiscovery): void {
            const el = this.contentEl; el.empty();
            el.createEl('p', { text: `${result.bases.length} compatible Bases · ${result.recognized.length} portable indexes · ${result.candidates.length} legacy candidates` });
            el.createEl('p', { text: 'Connect any listed Base using Change / Connect gallery. Adoption adds only al_schema: 1. Notes, OCR, custom fields and file locations stay intact.' });
            const list = el.createDiv({ cls: 'alp-confirm-list' });
            result.bases.forEach(path => list.createEl('p', { text: 'Base: ' + path }));
            const selected = new Set<string>();
            for (const candidate of result.candidates) {
                const label = list.createEl('label', { cls: 'alp-restore-candidate' });
                const checkbox = label.createEl('input', { attr: { type: 'checkbox' } }); checkbox.disabled = !!candidate.error;
                label.createSpan({ text: candidate.path + ' → ' + candidate.assetPath + (candidate.error ? ' · Protected: ' + candidate.error : '') });
                checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(candidate.path); else selected.delete(candidate.path); });
            }
            result.conflicts.forEach(reason => list.createEl('p', { text: reason, cls: 'alp-field-error' }));
            const feedback = el.createEl('p', { text: this.message, attr: { 'aria-live': 'polite' } });
            const actions = el.createDiv({ cls: 'alp-dialog-actions' }); actions.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());
            const adopt = actions.createEl('button', { text: 'Preview adoption…', cls: 'mod-cta' });
            adopt.addEventListener('click', () => { void (async () => {
                const candidates = result.candidates.filter(item => selected.has(item.path)); if (!candidates.length || adopt.disabled) return;
                adopt.disabled = true;
                try {
                    if (!await confirmAction(app, 'Adopt legacy indexes', candidates.map(item => item.path + ' — add al_schema: 1 only'), 'Back up and adopt')) return;
                    await service.adopt(candidates); this.message = 'Adopted. Backup: ' + plugin.store.lastReport; await this.load();
                } catch (e) { feedback.setText(String(e)); feedback.setAttribute('role','alert'); }
                finally { adopt.disabled = false; }
            })(); });
        }
        onClose(): void { this.closed = true; this.contentEl.empty(); }
    }
    new Restore(app).open();
}
export function recoveryDialog(app: App, plugin: AttachmentsLibraryPlugin): void {
    class Recovery extends Modal {
        private closed = false;
        onOpen(): void { this.titleEl.setText('Deletion recovery'); this.contentEl.setText('Loading recovery records…'); void this.load(); }
        async load(): Promise<void> {
            try {
                const journals = await plugin.deletions.recovery.list(recoveryVault(app));
                if (this.closed) return;
                this.contentEl.empty(); this.contentEl.createEl('p', { text: 'Restore originals before references. Subsequent edits and occupied paths are protected. Recovery backups remain outside the Vault.' });
                for (const issue of plugin.deletions.recovery.issues) this.contentEl.createEl('p', { text: issue, cls: 'alp-field-error' });
                if (!journals.length) this.contentEl.createEl('p', { text: 'No recovery records for this Vault.' });
                for (const journal of journals.slice(0,20)) {
                    const row = this.contentEl.createDiv({ cls: 'alp-delete-item' }); row.createEl('p', { text: journal.id + ' · ' + journal.phase });
                    row.createEl('p', { text: journal.files.map(file => file.path).join('\n') });
                    if (journal.error) row.createEl('p', { text: journal.error });
                    if (!['restored', 'not-executed'].includes(journal.phase)) row.createEl('button', { text: 'Review restoration…' }).addEventListener('click', event => { void (async () => {
                        const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
                        try {
                            if (!await confirmAction(app, 'Restore deletion backup', journal.files.map(file => file.path), 'Restore protected originals')) return;
                            const conflicts = await plugin.deletions.restoreJournal(journal);
                            row.createEl('p', { text: conflicts.length ? 'Recovery required: ' + conflicts.join('\n') : 'Restored originals and references.' });
                        } catch(e) { row.createEl('p', { text: String(e) }); }
                        finally { button.disabled = false; }
                    })(); });
                }
            } catch(e) { if (!this.closed) this.contentEl.setText(String(e)); }
        }
        onClose(): void { this.closed = true; this.contentEl.empty(); }
    }
    new Recovery(app).open();
}
