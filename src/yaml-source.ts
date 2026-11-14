import { parseDocument, isMap, isSeq, isScalar, Node } from 'yaml';
/** Duplicate user keys remain visible to source scanning; malformed syntax stays an error. */
export function yamlSource(text: string) {
    const doc = parseDocument(text, { uniqueKeys: false, keepSourceTokens: true });
    if (doc.errors.length) throw new Error('Invalid YAML: ' + doc.errors[0].message);
    return doc;
}
export function yamlStrings(text: string, excluded: ReadonlySet<string> = new Set()): string[] {
    const strings: string[] = [];
    const walk = (node: Node | null, root = '') => {
        if (isMap(node)) for (const pair of node.items) walk(pair.value as Node | null, root || (isScalar(pair.key) ? String(pair.key.value) : ''));
        else if (isSeq(node)) node.items.forEach(item => walk(item as Node | null, root));
        else if (isScalar(node) && typeof node.value === 'string' && !excluded.has(root)) strings.push(node.value);
    };
    walk(yamlSource(text).contents);
    return strings;
}
export function duplicateYamlKeys(text: string): string[] {
    const doc = yamlSource(text), seen = new Set<string>(), duplicates = new Set<string>();
    if (isMap(doc.contents)) for (const pair of doc.contents.items) if (isScalar(pair.key)) {
        const key = String(pair.key.value); if (seen.has(key)) duplicates.add(key); seen.add(key);
    }
    return [...duplicates];
}
/** Identity/protection keys must never be resolved by last-key-wins. */
export function yamlMetadata(text: string): Record<string, unknown> {
    const doc = yamlSource(text);
    const counts = new Map<string, number>();
    if (doc.contents && 'items' in doc.contents) for (const pair of doc.contents.items) {
        if (pair && typeof pair === 'object' && 'key' in pair && isScalar(pair.key)) {
            const key = String(pair.key.value); counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    for (const [key, count] of counts) if (count > 1 && ['attachment', '_filePath', 'al_schema', 'keep', 'al_keep'].includes(key)) throw new Error('Duplicate managed property: ' + key);
    const value: unknown = doc.toJS();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid frontmatter');
    return value as Record<string, unknown>;
}
