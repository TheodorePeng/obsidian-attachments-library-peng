import { App, Modal, Setting, SuggestModal } from 'obsidian';
export function chooseItem(app: App, title: string, items: string[]): Promise<string | null> {
    return new Promise(resolve => {
        let selected = false;
        class Picker extends SuggestModal<string> {
            getSuggestions(query: string): string[] { return items.filter(item => item.toLowerCase().includes(query.toLowerCase())); }
            renderSuggestion(item: string, el: HTMLElement): void { el.setText(item); }
            onChooseSuggestion(item: string): void { selected = true; resolve(item); }
            onClose(): void { queueMicrotask(() => { if (!selected) resolve(null); }); }
        }
        const picker = new Picker(app); picker.setPlaceholder(title); picker.open();
    });
}
export function enterPath(app: App, title: string, initial: string): Promise<string | null> {
    return new Promise(resolve => {
        let value = initial, saved = false;
        class Input extends Modal {
            onOpen(): void {
                this.titleEl.setText(title);
                new Setting(this.contentEl).setName('Vault-relative path').addText(input => input.setValue(value).onChange(next => { value = next; }));
                new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel').onClick(() => this.close())).addButton(b => b.setButtonText('Continue').setCta().onClick(() => { saved = true; resolve(value); this.close(); }));
            }
            onClose(): void { this.contentEl.empty(); if (!saved) resolve(null); }
        }
        new Input(app).open();
    });
}
