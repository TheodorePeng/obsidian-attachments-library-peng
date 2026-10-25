const LOCKED = new Set(['attachment', '_filePath', '_fileType', '_heuristic', 'al_schema', 'al_usageCount', 'al_usageState', '__proto__', 'constructor', 'prototype']);
export function notePropertyKey(id: string): string | null {
    if (id.startsWith('file.') || id.startsWith('formula.')) return null;
    return id.startsWith('note.') ? id.slice(5) : id;
}
export function isGalleryPropertyReadOnly(id: string): boolean {
    const key = notePropertyKey(id);
    return !key || LOCKED.has(key);
}
export function isEmptyGalleryValue(value: unknown): boolean {
    return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
}
export function galleryRowsSignature(groups: readonly { key: string; paths: readonly string[] }[]): string {
    return JSON.stringify(groups.map(group => [group.key, group.paths]));
}
