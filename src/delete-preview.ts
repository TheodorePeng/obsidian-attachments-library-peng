import { App, Modal, Setting } from 'obsidian';
import { DeletePlan, DeleteReview } from './deletions';
import { ReferenceOccurrence } from './references';
function fileLink(app: App, parent: HTMLElement, path: string, label = path, line?: number): void {
    const link = parent.createEl('a', { text: label, cls: 'alp-reference-link', attr: { href: path } });
    link.addEventListener('click', event => {
        event.preventDefault();
        void app.workspace.openLinkText(path, '', true, line === undefined ? undefined : { eState: { line: line - 1 } });
    });
}
function sourceLink(app: App, parent: HTMLElement, occurrence: ReferenceOccurrence): void {
    const locations = [occurrence.line && '行 ' + occurrence.line, occurrence.property && '属性 ' + occurrence.property, occurrence.nodeId && '节点 ' + occurrence.nodeId, occurrence.formula && '公式 ' + occurrence.formula].filter(Boolean);
    fileLink(app, parent, occurrence.sourcePath, occurrence.sourcePath + (locations.length ? ' · ' + locations.join(' / ') : ''), occurrence.line);
}
export function renderReview(app: App, parent: HTMLElement, review: DeleteReview): void {
    const item = parent.createDiv({ cls: 'alp-delete-item' });
    item.createEl('h3', { text: review.assetPath });
    item.createEl('p', { text: '原附件' }); fileLink(app, item, review.assetPath);
    item.createEl('p', { text: '关联索引：' + review.indexPaths.length });
    review.indexPaths.forEach(path => fileLink(app, item, path));
    if (review.hasUserBody) item.createEl('p', { text: '索引包含识别文本或用户正文；删除索引也会回收这些内容。' });
    if (review.blockedReason) item.createEl('p', { text: '保留：' + review.blockedReason, cls: 'alp-delete-blocked' });
    const usage = review.usage;
    if (!usage) return;
    item.createEl('p', { text: `业务来源 ${usage.count} 个：原附件 ${usage.assetSources.length}，索引 ${usage.indexSources.length}（合并按文件去重）` });
    const occurrences = item.createDiv(); let shown = 0;
    const more = item.createEl('button', { text: 'Show next 20 references' });
    const page = () => { usage.occurrences.slice(shown, shown + 20).forEach(occurrence => sourceLink(app, occurrences, occurrence)); shown += 20; more.hidden = shown >= usage.occurrences.length; };
    more.addEventListener('click', page); page();
    item.createEl('p', { text: `检查完整度：原附件 ${usage.assetCheckComplete ? '完整' : '待检查'}；索引 ${usage.indexCheckComplete ? '完整' : '待检查'}` });
    usage.issues.slice(0, 20).forEach(issue => {
        const p = item.createEl('p', { text: issue.reason + (issue.affectedPaths === null ? '（范围无法界定）' : '（影响：' + issue.affectedPaths.join('、') + '）') });
        fileLink(app, p, issue.sourcePath, '查看问题来源');
    });
    if (usage.issues.length > 20) item.createEl('p', { text: (usage.issues.length - 20) + ' additional diagnostic groups. Recheck after resolving the listed sources.' });
    const excluded = item.createEl('details');
    excluded.createEl('summary', { text: '不计入业务引用的自动关联' });
    excluded.createEl('p', { text: 'Base 查询结果和管理缩略图不计入使用。' });
    usage.excluded.forEach(occurrence => sourceLink(app, excluded, occurrence));
}
export function confirmDeletion(app: App, plan: DeletePlan, recheck?: () => Promise<DeletePlan>): Promise<boolean> {
    const origin = typeof activeDocument !== 'undefined' ? activeDocument.activeElement as HTMLElement | null : null;
    return new Promise(resolve => {
        let settled = false;
        class Preview extends Modal {
            onOpen(): void { this.draw(); }
            draw(): void {
                this.contentEl.empty();
                this.titleEl.setText(plan.mode === 'pair' ? 'Delete attachment and index' : 'Delete index only');
                this.contentEl.createEl('p', { text: 'Other text and unrelated nodes will be preserved. A recovery backup is created before changes. Files move to local .trash.' });
                const list = this.contentEl.createDiv({ cls: 'alp-confirm-list' });
                plan.reviews.forEach(review => renderReview(app, list, review));
                for (const skipped of plan.skipped) list.createEl('p', { text: 'Protected: ' + skipped.path + ' — ' + skipped.reason, cls: 'alp-delete-blocked' });
                list.createEl('h3', { text: 'Move to trash' });
                plan.targets.forEach(target => target.files.forEach(file => fileLink(app, list, file.path)));
                if (plan.changes?.length) {
                    list.createEl('h3', { text: 'Update references' });
                    for (const change of plan.changes) {
                        fileLink(app, list, change.path); list.createEl('p', { text: change.summary });
                        const preview = list.createEl('details'); preview.createEl('summary', { text: 'Preview exact document changes' });
                        preview.createEl('pre', { text: 'BEFORE\n' + change.before + '\nAFTER\n' + change.after });
                    }
                }
                const allowed = !!plan.targets.length && !plan.skipped.length;
                new Setting(this.contentEl)
                    .addButton(button => { button.setButtonText('Cancel').onClick(() => this.close()); button.buttonEl?.focus(); })
                    .addButton(button => button.setButtonText('Recheck').setDisabled(!recheck).onClick(async () => {
                        if (!recheck) return; button.setDisabled(true);
                        try { Object.assign(plan, await recheck()); this.draw(); } catch(e) { list.createEl('p', { text: String(e) }); button.setDisabled(false); }
                    }))
                    .addButton(button => button.setButtonText(plan.changes?.length ? 'Remove references and move to trash' : 'Move to trash').setCta().setDisabled(!allowed).onClick(() => { if (!allowed) return; settled = true; resolve(true); this.close(); }));
            }
            onClose(): void { this.contentEl.empty(); origin?.focus(); if (!settled) resolve(false); }
        }
        new Preview(app).open();
    });
}
export function showReferenceDetails(app: App, review: DeleteReview): void {
    class Details extends Modal {
        onOpen(): void { this.titleEl.setText('附件关联与引用详情'); renderReview(app, this.contentEl, review); }
        onClose(): void { this.contentEl.empty(); }
    }
    new Details(app).open();
}
