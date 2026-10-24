import { App, Modal, Setting } from 'obsidian';
export function confirmAction(app: App, title: string, lines: string[], confirmLabel = 'Confirm'): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        class Confirmation extends Modal {
            onOpen(): void {
                this.titleEl.setText(title);
                const list = this.contentEl.createEl('div', { cls: 'alp-confirm-list' });
                for (const line of lines)
                    list.createEl('p', { text: line });
                new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close())).addButton(button => button.setButtonText(confirmLabel).setCta().onClick(() => { settled = true; resolve(true); this.close(); }));
            }
            onClose(): void { this.contentEl.empty(); if (!settled)
                resolve(false); }
        }
        new Confirmation(app).open();
    });
}
