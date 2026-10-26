import { Notice } from 'obsidian';
import { GalleryPropertyEdits, PropertyDraft, PropertyEditKind } from './property-edits';
const KIND_LABELS: Record<PropertyEditKind, string> = { text: '文本', number: '数字', date: '日期', datetime: '日期时间', list: '列表', boolean: '布尔' };
/** An editing surface independent of card re-rendering; drafts belong to the plugin session. */
export class GalleryPropertyEditor {
    private element?: HTMLElement;
    private draft?: PropertyDraft;
    private stop?: () => void;
    constructor(private service: GalleryPropertyEdits, private doc: Document) {}
    open(draft: PropertyDraft, anchor?: HTMLElement, displayName = draft.key): void {
        this.close(); this.draft = draft;
        const element = this.doc.body.createDiv({ cls: 'alp-property-editor', attr: { role: 'dialog', 'aria-label': '编辑属性 ' + displayName } });
        this.element = element;
        element.createEl('strong', { text: displayName });
        element.createDiv({ text: draft.indexPath, cls: 'alp-property-editor-path' });
        const field = element.createDiv();
        const error = element.createDiv({ cls: 'alp-property-editor-error', attr: { role: 'status' } });
        let currentInput: HTMLInputElement | HTMLTextAreaElement;
        const drawInput = () => {
            field.empty();
            const input = draft.kind === 'list' || (draft.kind === 'text' && draft.input.includes('\n')) ? field.createEl('textarea') : field.createEl('input');
            currentInput = input;
            input.className = 'alp-property-input';
            if (input instanceof this.doc.defaultView!.HTMLInputElement) {
                input.type = draft.kind === 'number' ? 'number' : draft.kind === 'date' ? 'date' : draft.kind === 'datetime' ? 'datetime-local' : draft.kind === 'boolean' ? 'checkbox' : 'text';
                if (draft.kind === 'datetime' || draft.kind === 'number') input.step = 'any';
                if (draft.kind === 'boolean') input.checked = draft.input === 'true';
            }
            input.value = draft.input;
            input.setAttribute('aria-label', displayName);
            input.addEventListener('input', () => { draft.input = draft.kind === 'boolean' && input instanceof this.doc.defaultView!.HTMLInputElement ? String(input.checked) : input.value; });
            input.addEventListener('keydown', rawEvent => {
                const event = rawEvent as KeyboardEvent;
                if (event.key === 'Escape') { event.preventDefault(); this.service.cancel(draft.id); this.close(); }
                if (event.key === 'Enter' && (input.tagName !== 'TEXTAREA' || event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
            });
            input.focus();
        };
        if (draft.initial == null && draft.key !== 'al_keep' && draft.key !== 'keep') {
            const type = element.createEl('select', { attr: { 'aria-label': '属性输入类型' } });
            for (const [kind, label] of Object.entries(KIND_LABELS)) type.createEl('option', { text: label, attr: { value: kind } });
            type.value = draft.kind;
            type.addEventListener('change', () => { draft.kind = type.value as PropertyEditKind; if (draft.kind === 'boolean') draft.input = 'false'; drawInput(); });
        }
        if (draft.kind === 'datetime' && typeof draft.initial === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(draft.initial)) element.createEl('small', { text: '保留原值的时区后缀。' });
        const actions = element.createDiv({ cls: 'alp-property-editor-actions' });
        const cancel = actions.createEl('button', { text: '取消' }); cancel.addEventListener('click', () => { this.service.cancel(draft.id); this.close(); });
        const commit = actions.createEl('button', { text: '保存', cls: 'mod-cta' });
        const save = async () => {
            commit.disabled = true;
            try { if (!currentInput.checkValidity()) throw new Error('输入格式无效，请检查后保存'); await this.service.save(draft.id); this.close(); }
            catch (problem) { error.setText(problem instanceof Error ? problem.message : '保存失败'); new Notice(error.textContent ?? '保存失败'); commit.disabled = false; }
        };
        commit.addEventListener('click', () => { void save(); });
        this.stop = this.service.subscribe(() => { commit.disabled = draft.saving; if (!this.service.drafts.has(draft.id)) this.close(); });
        drawInput(); error.setText(draft.error ?? '');
        const rect = anchor?.getBoundingClientRect();
        element.style.left = Math.max(8, Math.min(rect?.left ?? 24, (this.doc.defaultView?.innerWidth ?? 800) - 336)) + 'px';
        element.style.top = Math.max(8, Math.min(rect?.bottom ?? 80, (this.doc.defaultView?.innerHeight ?? 700) - 300)) + 'px';
    }
    close(): void { this.stop?.(); this.stop = undefined; this.element?.remove(); this.element = undefined; this.draft = undefined; }
}
