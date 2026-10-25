import { TFile, parseYaml, stringifyYaml } from 'obsidian';
import { vi } from 'vitest';
export function fixture(contents: Record<string, string>) {
    const data = new Map(Object.entries(contents));
    const files = new Map<string, TFile>();
    const writes: string[] = [];
    const add = (path: string) => { const f = new TFile(); f.path = path; f.name = path.split('/').pop()!; f.extension = f.name.split('.').pop()!; f.basename = f.name.slice(0, -f.extension.length - 1); f.stat = { mtime: 1, ctime: 1, size: data.get(path)!.length } as any; files.set(path, f); return f; };
    for (const path of data.keys())
        add(path);
    const events: Record<string, Function> = {};
    const logData = new Map<string, string>();
    const app: any = { vault: { configDir: '.obsidian', adapter: { exists: vi.fn(async (p: string) => logData.has(p)), mkdir: vi.fn(async (p: string) => { logData.set(p, 'directory'); }), read: vi.fn(async (p: string) => logData.get(p)), write: vi.fn(async (p: string, s: string) => { logData.set(p, s); }) }, on: vi.fn((name: string, cb: Function) => { events[name] = cb; return name; }), getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()].filter(f => f.extension === 'md'), getFileByPath: (p: string) => files.get(p) ?? null, getFolderByPath: () => ({}), getAbstractFileByPath: (p: string) => files.get(p) ?? null,
            cachedRead: async (f: TFile) => data.get(f.path)!, read: async (f: TFile) => data.get(f.path)!, readBinary: async (f: TFile) => new TextEncoder().encode(data.get(f.path)).buffer,
            createFolder: vi.fn(async () => { }), create: vi.fn(async (p: string, s: string) => { data.set(p, s); writes.push(p); return add(p); }), process: vi.fn(async (f: TFile, cb: (s:string)=>string) => { const next=cb(data.get(f.path)!);await app.vault.modify(f,next);return next; }), modify: vi.fn(async (f: TFile, s: string) => { data.set(f.path, s); f.stat.mtime++; (f.stat as any).size = s.length; writes.push(f.path); }), trash: vi.fn(async (f: TFile) => { data.delete(f.path); files.delete(f.path); writes.push('trash:' + f.path); }), getResourcePath: (f: TFile) => 'app://' + f.path },
        metadataCache: { getFileCache: (f: TFile) => f.extension === 'md' ? { links: [], embeds: [], frontmatterLinks: [], frontmatter: parseYaml(/^---\n([\s\S]*?)\n---/.exec(data.get(f.path) ?? '')?.[1] ?? '') ?? {} } : null, getFirstLinkpathDest: (p: string, source: string) => files.get(p) ?? files.get(source.split('/').slice(0, -1).concat(p).join('/')) ?? [...files.values()].find(f => f.name === p || f.path === p + '.md') ?? null, on: vi.fn() },
        workspace: { getLeavesOfType: () => [], getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => { }), setViewState: vi.fn(async () => { }) })), openLinkText: vi.fn(async () => { }), trigger: vi.fn(), on: vi.fn(), onLayoutReady: (cb: any) => cb(), getActiveFile: () => null },
        fileManager: { processFrontMatter: vi.fn(async (f: TFile, cb: any) => { const s = data.get(f.path)!; const match = /^---\n([\s\S]*?)\n---\n/.exec(s); const fm = match ? parseYaml(match[1]) : {}; cb(fm); await app.vault.modify(f, '---\n' + stringifyYaml(fm) + '---\n' + (match ? s.slice(match[0].length) : s)); }), renameFile: vi.fn() } };
    return { app, data, files, writes, add, events, logData };
}
