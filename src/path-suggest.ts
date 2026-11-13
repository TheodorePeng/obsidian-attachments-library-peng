import { AbstractInputSuggest, App, TFolder } from 'obsidian';

/** Native type-ahead UI; selecting a candidate changes only the input draft. */
export class PathSuggest extends AbstractInputSuggest<string> {
    private composing = false;
    private start = () => { this.composing = true; this.close(); };
    private end = () => { this.composing = false; };
    private key = (event: KeyboardEvent) => { if (event.isComposing || this.composing) event.stopImmediatePropagation(); };
    constructor(private host: App, private input: HTMLInputElement, private kind: 'base' | 'folder', private change: (path: string) => void) {
        super(host, input);
        input.addEventListener('compositionstart', this.start);
        input.addEventListener('compositionend', this.end);
        input.addEventListener('keydown', this.key, true);
    }
    getSuggestions(query: string): string[] {
        if (this.composing) return [];
        const paths = this.kind === 'base'
            ? this.host.vault.getFiles().filter(file => file.extension.toLowerCase() === 'base').map(file => file.path)
            : this.host.vault.getAllLoadedFiles().filter(file => file instanceof TFolder && file.path !== '/').map(file => file.path);
        const value = query.toLocaleLowerCase();
        return paths.filter(path => !path.split('/').some(part => part.startsWith('.')) && path.toLocaleLowerCase().includes(value))
            .sort((a, b) => Number(b.toLocaleLowerCase().startsWith(value)) - Number(a.toLocaleLowerCase().startsWith(value)) || a.localeCompare(b));
    }
    renderSuggestion(path: string, el: HTMLElement): void { el.setText(path); }
    selectSuggestion(path: string, event: MouseEvent | KeyboardEvent): void {
        if (this.composing || ('isComposing' in event && event.isComposing)) return;
        this.setValue(path); this.change(path); this.close();
    }
    dispose(): void {
        this.close();
        this.input.removeEventListener('compositionstart', this.start);
        this.input.removeEventListener('compositionend', this.end);
        this.input.removeEventListener('keydown', this.key, true);
    }
}
