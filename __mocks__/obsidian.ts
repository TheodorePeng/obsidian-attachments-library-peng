import { vi } from 'vitest';
import { StateField } from '@codemirror/state';
export { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
export const requestUrl = vi.fn();
export class TAbstractFile {
    path = '';
}
export class TFile extends TAbstractFile {
    extension = '';
    basename = '';
    name = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
}
export class Plugin {
    app: any = {};
    manifest: any = {};
    disposers: (() => void)[] = [];
    constructor(app?: any, manifest?: any) { if (app)
        this.app = app; if (manifest)
        this.manifest = manifest; }
    async loadData(): Promise<any> { return {}; }
    async saveData(_data: any): Promise<void> { }
    addCommand(_command: any): void { }
    addSettingTab(_tab: any): void { }
    registerEvent(_event: any): void { }
    register(cb: () => void) { this.disposers.push(cb); }
    registerHoverLinkSource(_id: any, _config: any) { }
    registerBasesView(_id: any, _config: any) { }
    registerMarkdownPostProcessor(_cb: any) { }
    registerEditorExtension(_extension: any) { }
}
export class PluginSettingTab {
    containerEl: any;
    constructor(public app: any, public plugin: any) { this.containerEl = typeof document === 'undefined' ? { empty() { } } : document.createElement('div'); }
    display() { }
    hide() { }
}
export const settingInstances: any[] = [];
export class Setting {
    name = '';
    textCallbacks: any[] = [];
    toggleCallbacks: any[] = [];
    buttonCallbacks: any[] = [];
    dropdownCallbacks: any[] = [];
    constructor(_container: any) { settingInstances.push(this); }
    setName(name: string) { this.name = name; return this; }
    setDesc(_desc: string) { return this; }
    setHeading() { return this; }
    addText(cb: any) { const text: any = { setPlaceholder: () => text, setValue: () => text, onChange: (fn: any) => { this.textCallbacks.push(fn); return text; } }; cb(text); return this; }
    addToggle(cb: any) { const toggle: any = { setValue: () => toggle, onChange: (fn: any) => { this.toggleCallbacks.push(fn); return toggle; } }; cb(toggle); return this; }
    addButton(cb: any) { const button: any = { setButtonText: () => button, setCta: () => button, setDisabled: () => button, onClick: (fn: any) => { this.buttonCallbacks.push(fn); return button; } }; cb(button); return this; }
    addDropdown(cb: any) { const drop: any = { setValue: () => drop, addOptions: () => drop, onChange: (fn: any) => { this.dropdownCallbacks.push(fn); return drop; } }; cb(drop); return this; }
}
export const noticeMessages: string[] = [];
export class Notice {
    constructor(message: string) { noticeMessages.push(message); }
}
export const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
export class Component {
    callbacks: any[] = [];
    unload() { (this as any).onunload?.(); for (const callback of this.callbacks) callback(); }
    register(cb: any) { this.callbacks.push(cb); }
    registerDomEvent(el: any, type: any, cb: any) { el.addEventListener(type, cb); this.register(() => el.removeEventListener(type, cb)); }
}
export class MarkdownRenderChild extends Component {
    constructor(public containerEl: any) { super(); }
}
export class BasesView extends Component {
    app: any;
    data: any;
    config: any;
    constructor(public controller: any) { super(); this.app = controller.app; this.data = controller.data; this.config = controller.config; }
}
export class MarkdownView {
    file: any;
    editor: any;
    getMode() { return "source"; }
}
export const modalInstances: any[] = [];
export class Modal {
    contentEl: any;
    titleEl: any;
    constructor(public app: any) { modalInstances.push(this); if (typeof document !== 'undefined') {
        this.contentEl = document.createElement('div');
        this.titleEl = document.createElement('h2');
    } }
    open() { this.onOpen(); }
    close() { this.onClose(); }
    onOpen() { }
    onClose() { }
}
export const menuInstances: any[] = [];
export class Menu {
    items: any[] = [];
    constructor() { menuInstances.push(this); }
    addItem(cb: any) { const item: any = { setTitle: (title: any) => { item.title = title; return item; }, setIcon: () => item, onClick: (fn: any) => { item.callback = fn; return item; } }; cb(item); this.items.push(item); return this; }
    showAtMouseEvent(_event: any) { }
    showAtPosition(_position: any) { }
}
export const setIcon = vi.fn();
export const editorInfoField = StateField.define<any>({ create: () => ({ file: null }), update: value => value });

export class RenderContext { hoverPopover = null; }
export class Value {
    constructor(public raw: any) {}
    toString() { return Array.isArray(this.raw) ? this.raw.join(', ') : this.raw == null ? '' : String(this.raw); }
    isTruthy() { return Array.isArray(this.raw) ? this.raw.length > 0 : !!this.raw; }
    renderTo(el: HTMLElement, _ctx: RenderContext) { el.textContent = this.toString(); }
}
export class NullValue extends Value { constructor() { super(null); } }
export class ListValue extends Value {}
export class StringValue extends Value {}
export class BooleanValue extends Value {}
export class NumberValue extends Value {}
export class LinkValue extends StringValue { renderTo(el:HTMLElement,_ctx:RenderContext) { const a=document.createElement('a');a.href=String(this.raw);a.textContent=String(this.raw);el.appendChild(a); } }

export class SuggestModal<T> extends Modal {
    setPlaceholder(_text: string) { return this; }
    getSuggestions(_query: string): T[] { return []; }
    renderSuggestion(_item: T, _el: HTMLElement) {}
    onChooseSuggestion(_item: T) {}
}
