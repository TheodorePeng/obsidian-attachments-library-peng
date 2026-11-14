import { vi, afterAll } from 'vitest';
// Exercise real recovery I/O while keeping synthetic journals out of the user's backup directory.
vi.mock('../src/deletion-recovery', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/deletion-recovery')>();
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alp-vitest-recovery-'));
    afterAll(() => fs.rm(root, { recursive: true, force: true }));
    return { ...actual, DeletionRecovery: class extends actual.DeletionRecovery {
        constructor(location?: string) { super(location ?? root); }
    } };
});
if (typeof window === 'undefined')
    Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
if (typeof HTMLElement !== 'undefined') {
    const proto: any = HTMLElement.prototype;
    proto.empty = function () { this.replaceChildren(); };
    proto.addClass = function (...classes: string[]) { this.classList.add(...classes); };
    proto.removeClass = function (...classes: string[]) { this.classList.remove(...classes); };
    proto.setText = function (text: string) { this.textContent = text; };
    proto.createEl = function (tag: string, options: any = {}) { const el = document.createElement(tag); if (options.cls)
        el.className = options.cls; if (options.text !== undefined)
        el.textContent = options.text; if (options.attr)
        for (const [key, value] of Object.entries(options.attr))
            el.setAttribute(key, String(value)); this.appendChild(el); return el; };
    proto.createDiv = function (options: any = {}) { return this.createEl('div', options); };
    proto.createSpan = function (options: any = {}) { return this.createEl('span', options); };
}
