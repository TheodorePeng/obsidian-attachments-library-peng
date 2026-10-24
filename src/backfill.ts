import { App, Notice } from 'obsidian';
import { AttachmentsLibrarySettings } from './types';
import { SidecarManager } from './sidecar-manager';
import { isEligiblePath } from './file-policy';
import { confirmAction } from './dialogs';
export class BackfillManager {
    constructor(private app: App, private settings: AttachmentsLibrarySettings, private sidecarManager: SidecarManager, private save?: () => Promise<void>, private confirm = confirmAction) { }
    async runBackfill(): Promise<void> {
        if (!this.sidecarManager.isActive())
            return;
        const registry = this.sidecarManager.registry;
        await registry.refresh();
        const files = this.app.vault.getFiles().filter(f => isEligiblePath(f.path, this.settings));
        const missing = files.filter(f => !registry.records.get(f.path)?.indexPath && !registry.records.get(f.path)?.conflict);
        const conflicts = [...registry.records.values()].filter(r => r.conflict);
        const approved = await this.confirm(this.app, 'Scan and index attachments', [
            `${files.length} eligible attachments; ${missing.length} new metadata documents; ${conflicts.length} conflicts skipped.`,
            'Existing indexes keep their location, Properties and body. Derived al_* usage fields will be adopted after this scan.',
            ...missing.map(f => f.path + ' → ' + this.sidecarManager.getSidecarPath(f.path)), ...conflicts.map(r => 'Protected conflict: ' + r.assetPath),
        ], 'Create indexes and adopt usage fields');
        if (!approved || !this.sidecarManager.isActive())
            return;
        for (const file of missing) {
            if (!this.sidecarManager.isActive())
                return;
            await this.sidecarManager.createSidecar(file);
        }
        if (!this.sidecarManager.isActive())
            return;
        this.settings.initialScanComplete = true;
        await this.save?.();
        await registry.refresh();
        await this.sidecarManager.references?.refresh();
        for (const record of registry.records.values())
            await this.sidecarManager.writeDerived(record);
        new Notice(`Indexed ${missing.length} attachments. ${conflicts.length} conflicts preserved.`);
    }
}
