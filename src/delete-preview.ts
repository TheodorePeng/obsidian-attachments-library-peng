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
    usage.occurrences.forEach(occurrence => sourceLink(app, item, occurrence));
    item.createEl('p', { text: `检查完整度：原附件 ${usage.assetCheckComplete ? '完整' : '待检查'}；索引 ${usage.indexCheckComplete ? '完整' : '待检查'}` });
    usage.issues.forEach(issue => {
        const p = item.createEl('p', { text: issue.reason + (issue.affectedPaths === null ? '（范围无法界定）' : '（影响：' + issue.affectedPaths.join('、') + '）') });
        fileLink(app, p, issue.sourcePath, '查看问题来源');
    });
    const excluded = item.createEl('details');
    excluded.createEl('summary', { text: '不计入业务引用的自动关联' });
    excluded.createEl('p', { text: 'Base 查询结果和管理缩略图不计入使用。' });
    usage.excluded.forEach(occurrence => sourceLink(app, excluded, occurrence));
}
export function confirmDeletion(app: App, plan: DeletePlan): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        class Preview extends Modal {
            onOpen(): void {
                this.titleEl.setText(plan.mode === 'pair' ? '安全删除附件与索引' : '仅删除索引');
                this.contentEl.createEl('p', { text: `可执行 ${plan.targets.length} 项，保留 ${plan.skipped.length} 项。确认后重新检查，文件进入本地 .trash。` });
                const list = this.contentEl.createDiv({ cls: 'alp-confirm-list' });
                plan.reviews.forEach(review => renderReview(app, list, review));
                for (const skipped of plan.skipped) if (!plan.reviews.some(r => r.assetPath === skipped.path || r.indexPaths.includes(skipped.path))) list.createEl('p', { text: skipped.path + '：' + skipped.reason });
                if (plan.targets.length) {
                    list.createEl('h3', { text: '将回收的文件' });
                    plan.targets.forEach(target => target.files.forEach(file => fileLink(app, list, file.path)));
                }
                new Setting(this.contentEl)
                    .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
                    .addButton(button => button.setButtonText('移入回收站').setCta().setDisabled(!plan.targets.length).onClick(() => { if (!plan.targets.length) return; settled = true; resolve(true); this.close(); }));
            }
            onClose(): void { this.contentEl.empty(); if (!settled) resolve(false); }
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
