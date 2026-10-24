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
