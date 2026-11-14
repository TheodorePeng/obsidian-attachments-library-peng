import { App, FileSystemAdapter } from 'obsidian';
/** Pure navigation URLs are provably not document references. Unknown local schemes stay blocked. */
export function localTarget(app: App, raw: string): { path?: string; ignore?: boolean; unknown?: boolean } {
    if (!/^(file|obsidian):/i.test(raw)) return { path: raw };
    try {
        const uri = new URL(raw);
        if (uri.protocol === 'obsidian:') {
            const params = uri.searchParams;
            const file = params.get('file') ?? params.get('filepath');
            const vault = params.get('vault');
            if (file) {
                const adapter = app.vault.adapter;
                const currentPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
                if (vault && vault !== app.vault.getName() && vault !== currentPath) return /^[a-f\d]{16}$/i.test(vault) ? { unknown: true } : { ignore: true };
                return { path: file };
            }
            if (['show-plugin', 'show-theme'].includes(uri.hostname)) return { ignore: true };
            if (['adv-uri', 'advanced-uri'].includes(uri.hostname) && params.has('settingid') && [...params.keys()].every(key => ['vault', 'settingid', 'settingsection'].includes(key))) return { ignore: true };
            return { unknown: true };
        }
        const adapter = app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter) || uri.hostname && uri.hostname !== 'localhost') return { unknown: true };
        const root = adapter.getBasePath().replace(/\\/g, '/').replace(/\/$/, '');
        const path = decodeURIComponent(uri.pathname);
        return path.startsWith(root + '/') ? { path: path.slice(root.length + 1) } : { ignore: true };
    } catch { return { unknown: true }; }
}
