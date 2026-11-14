import { fingerprint } from './operation-store';
import { App } from 'obsidian';
import { isMap, isSeq, isScalar, Node } from 'yaml';
import { parseMarkdownLinks, TextRange, externalLink } from './markdown-links';
import { localTarget } from './local-target';
import { yamlSource } from './yaml-source';
export interface SourceChange { path: string; before: string; after: string; beforeHash: string; afterHash: string; summary: string; }
interface Edit extends TextRange { value: string; }
export function applyTextEdits(text: string, edits: Edit[]): string {
    let limit = text.length;
    for (const edit of [...edits].sort((a,b) => b.from - a.from || b.to - a.to)) {
        if (edit.from < 0 || edit.to > limit || edit.from > edit.to) throw new Error('Overlapping or invalid reference edits');
        text = text.slice(0, edit.from) + edit.value + text.slice(edit.to); limit = edit.from;
    }
    return text;
}
export function targetMatcher(app: App, source: string, targets: ReadonlySet<string>): (raw: string) => boolean {
    return raw => {
        if (externalLink(raw) || raw.startsWith('#')) return false;
        const local = localTarget(app, raw); if (!local.path) return false;
        let path: string;
        try { path = /^(file|obsidian):/i.test(raw) ? local.path.split('#')[0] : decodeURIComponent(local.path.split('#')[0]); } catch { return false; }
        return targets.has(app.metadataCache.getFirstLinkpathDest(path, source)?.path ?? path);
    };
}
export function rewriteMarkdown(text: string, matches: (raw: string) => boolean): string {
    const parsed = parseMarkdownLinks(text), selected = parsed.links.filter(link => matches(link.link));
    const replacement = (link: typeof selected[number]): string => {
        if (!link.labelRange) return link.replacement;
        const range = link.labelRange;
        if (!text.slice(range.from, range.to).trim()) return link.replacement;
        const children = selected.filter(child => child !== link && child.offset >= range.from && child.end <= range.to);
        const roots = children.filter(child => !children.some(parent => parent !== child && parent.offset <= child.offset && parent.end >= child.end));
        return rewriteMarkdown(applyTextEdits(text.slice(range.from, range.to), roots.map(child => ({ from: child.offset - range.from, to: child.end - range.from, value: replacement(child) }))), matches);
    };
    const roots = selected.filter(link => !selected.some(parent => parent !== link && parent.offset <= link.offset && parent.end >= link.end));
    const edits: Edit[] = roots.map(link => ({ from: link.offset, to: link.end, value: replacement(link) }));
    const seen = new Set<string>();
    for (const link of selected) if (link.definition && !seen.has(link.identifier!) && parsed.links.filter(other => other.identifier === link.identifier).every(other => selected.includes(other))) {
        seen.add(link.identifier!); edits.push({ ...link.definition, value: '' });
    }
    return applyTextEdits(text, edits);
}
/** CST ranges keep duplicate keys, comments and unrelated formatting byte-for-byte. */
export function rewriteYaml(text: string, matches: (raw: string) => boolean, formulas = false, rawProperties: ReadonlySet<string> = new Set()): string {
    const document = yamlSource(text), edits: Edit[] = [];
    const walk = (node: Node | null, parent?: Node, index = 0, property = '') => {
        if (isMap(node)) { for (const pair of node.items) walk(pair.value as Node | null, undefined, 0, isScalar(pair.key) ? String(pair.key.value) : ''); return; }
        if (isSeq(node)) { node.items.forEach((item, i) => walk(item as Node | null, node, i, property)); return; }
        if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return;
        const links = parseMarkdownLinks(node.value).links;
        const pure = links.length === 1 && matches(links[0].link) && node.value.slice(0, links[0].offset).trim() === '' && node.value.slice(links[0].end).trim() === '';
        let after = pure || rawProperties.has(property) && matches(node.value) ? '' : rewriteMarkdown(node.value, matches);
        if (formulas) after = after.replace(/\b(link|image|file)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?\s*\)/g, (whole: string, name: string, literal: string, display?: string) => {
            const decode = (value: string) => value[0] === '"' ? JSON.parse(value) as string : value.slice(1,-1).replace(/\\'/g,"'");
            try { return matches(decode(literal)) ? JSON.stringify(name === 'image' ? '' : display ? decode(display) : decode(literal).split('/').pop()) : whole; } catch { return whole; }
        });
        if (after === node.value) return;
        let from = node.range[0], to = node.range[1], value = JSON.stringify(after);
        if (!after.trim() && isSeq(parent)) {
            if (parent.flow) {
                if (index < parent.items.length - 1) to = (parent.items[index + 1] as Node).range![0];
                else if (index > 0) from = (parent.items[index - 1] as Node).range![1];
            } else {
                const line = text.lastIndexOf('\n', from - 1) + 1;
                if (/^\s*-\s*$/.test(text.slice(line, from))) { from = line; const end = text.indexOf('\n', to); to = end < 0 ? text.length : end + 1; }
            }
            value = '';
        }
        if (value && text.slice(from, to).endsWith('\n')) value += '\n';
        edits.push({ from, to, value });
    };
    walk(document.contents);
    const merged: Edit[] = [];
    for (const edit of edits.sort((a,b) => a.from - b.from)) {
        const last = merged[merged.length - 1];
        if (last && last.value === '' && edit.value === '' && edit.from <= last.to) last.to = Math.max(last.to, edit.to);
        else merged.push(edit);
    }
    return applyTextEdits(text, merged);
}
export function planReferenceEdit(app: App, path: string, before: string, targets: ReadonlySet<string>, rawProperties: ReadonlySet<string> = new Set()): SourceChange {
    const matches = targetMatcher(app, path, targets);
    let after: string;
    if (path.toLowerCase().endsWith('.canvas')) {
        const canvas = JSON.parse(before) as { nodes: Record<string, unknown>[]; edges?: { fromNode: string; toNode: string }[] };
        if (!Array.isArray(canvas.nodes)) throw new Error('Invalid Canvas');
        const removed = new Set<string>();
        canvas.nodes = canvas.nodes.filter(node => {
            const direct = node.type === 'file' ? node.file : node.type === 'link' ? node.url : undefined;
            if (typeof direct === 'string' && matches(direct)) { removed.add(node.id as string); return false; }
            if (node.type === 'text' && typeof node.text === 'string') {
                const next = rewriteMarkdown(node.text, matches);
                if (next !== node.text && !next.trim()) { removed.add(node.id as string); return false; }
                node.text = next;
            }
            if (typeof node.background === 'string' && matches(node.background)) delete node.background;
            return true;
        });
        if (canvas.edges) canvas.edges = canvas.edges.filter(edge => !removed.has(edge.fromNode) && !removed.has(edge.toNode));
        after = JSON.stringify(canvas, null, '\t') + '\n';
    } else if (path.toLowerCase().endsWith('.base')) after = rewriteYaml(before, matches, true);
    else {
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(before);
        if (match) {
            const start = before.indexOf(match[1]), yaml = rewriteYaml(match[1], matches, false, rawProperties);
            after = before.slice(0, start) + yaml + before.slice(start + match[1].length, match[0].length) + rewriteMarkdown(before.slice(match[0].length), matches);
        } else after = rewriteMarkdown(before, matches);
    }
    if (after === before) throw new Error('Reference cannot be safely edited: ' + path);
    return { path, before, after, beforeHash: fingerprint(before), afterHash: fingerprint(after), summary: path.endsWith('.canvas') ? 'Remove referenced nodes / edges or text references; preserve other Canvas content' : 'Remove matching references; preserve surrounding text' };
}
