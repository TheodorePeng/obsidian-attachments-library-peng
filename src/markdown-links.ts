import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
export interface TextRange { from: number; to: number; }
export interface ParsedLink {
    link: string; offset: number; end: number; line: number; kind: 'link' | 'embed'; replacement: string;
    definition?: TextRange; identifier?: string;
    labelRange?: TextRange;
}
export const externalLink = (link: string): boolean => /^(?:(?!file:|obsidian:)[a-z][\w+.-]*:|\/\/)/i.test(link);
/** Source offsets are UTF-16 offsets, exactly as used by String.slice and Obsidian. */
export function parseMarkdownLinks(text: string): { links: ParsedLink[]; ignored: TextRange[]; uncertain: boolean } {
    const tree = fromMarkdown(text, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] });
    const links: ParsedLink[] = [], ignored: TextRange[] = [];
    let uncertain = false;
    type Node = { type: string; url?: string; identifier?: string; value?: string; children?: Node[]; position?: { start: { offset?: number; line: number }; end: { offset?: number } } };
    const definitions = new Map<string, { url: string; range: TextRange }>();
    const define = (node: Node) => { if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), { url: node.url, range: { from: node.position?.start.offset ?? 0, to: node.position?.end.offset ?? 0 } }); node.children?.forEach(define); };
    define(tree);
    const label = (node: Node): string => node.children?.map(child => child.value ?? label(child)).join('') ?? '';
    const visit = (node: Node) => {
        const from = node.position?.start.offset ?? 0, to = node.position?.end.offset ?? from;
        if (['code', 'inlineCode', 'math', 'inlineMath', 'definition'].includes(node.type)) { ignored.push({ from, to }); return; }
        if (node.type === 'html') {
            const html = node.value ?? '';
            if (/^<!--/.test(html.trim())) { ignored.push({ from, to }); return; }
            for (const tag of html.matchAll(/<(img|image|audio|video|source|iframe|embed|object|a)\b[^>]*>/gi)) {
                const attrs = [...tag[0].matchAll(/\b(src|href|srcset|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)];
                for (const attr of attrs) {
                    const raw = attr[2] ?? attr[3] ?? attr[4];
                    if (externalLink(raw) && attr[1].toLowerCase() !== 'srcset') continue;
                    if (attr[1].toLowerCase() === 'srcset' || /[{}]|<%/.test(raw) || !['img', 'a'].includes(tag[1].toLowerCase())) { uncertain = true; continue; }
                    const offset = from + tag.index, startEnd = offset + tag[0].length;
                    const anchor = tag[1].toLowerCase() === 'a';
                    const closing = anchor ? /<\/a\s*>/i.exec(text.slice(startEnd)) : null;
                    if (anchor && !closing) { uncertain = true; continue; }
                    const end = anchor ? startEnd + closing!.index + closing![0].length : startEnd;
                    links.push({ link: raw.replace(/&amp;/g, '&'), offset, end, line: text.slice(0, offset).split('\n').length, kind: anchor ? 'link' : 'embed', replacement: anchor ? text.slice(startEnd, startEnd + closing!.index) : '' });
                }
            }
            return;
        }
        if (['link', 'image', 'linkReference', 'imageReference'].includes(node.type)) {
            const definition = definitions.get(node.identifier?.toLowerCase() ?? '');
            const link = node.url ?? definition?.url;
            ignored.push({ from, to });
            let labelRange: TextRange | undefined;
            if (text[from] === '[') {
                let depth = 1;
                for (let i = from + 1; i < to; i++) {
                    if (text[i] === '\\') { i++; continue; }
                    if (text[i] === '[') depth++;
                    if (text[i] === ']' && --depth === 0) { labelRange = { from: from + 1, to: i }; break; }
                }
            }
            if (link) links.push({ link, offset: from, end: to, line: node.position?.start.line ?? 1, kind: node.type.startsWith('image') ? 'embed' : 'link', replacement: node.type.startsWith('image') ? '' : labelRange && text.slice(labelRange.from, labelRange.to).trim() ? text.slice(labelRange.from, labelRange.to) : /^(file|obsidian):/i.test(link) ? '`' + link + '`' : label(node) || link.split('/').pop()!, labelRange, definition: definition?.range, identifier: node.identifier?.toLowerCase() });
            node.children?.forEach(visit);
            return;
        }
        node.children?.forEach(visit);
    };
    visit(tree);
    for (const match of text.matchAll(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
        const offset = match.index;
        if (ignored.some(range => offset >= range.from && offset < range.to)) continue;
        let escapes = 0; for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) escapes++;
        if (escapes % 2) continue;
        links.push({ link: match[1], offset, end: offset + match[0].length, line: text.slice(0, offset).split('\n').length, kind: match[0].startsWith('!') ? 'embed' : 'link', replacement: match[0].startsWith('!') ? '' : match[2] || match[1].split('#')[0].split('/').pop()! });
    }
    // Obsidian also linkifies bare local application URLs. Keep protected syntax excluded.
    for (const match of text.matchAll(/\b(?:obsidian|file):\/\/[^\s<>"'`]+/gi)) {
        const offset = match.index;
        if (ignored.some(range => offset >= range.from && offset < range.to) || links.some(link => offset >= link.offset && offset < link.end)) continue;
        let raw = match[0].replace(/[.,;!]+$/, '');
        while (raw.endsWith(')') && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1);
        links.push({ link: raw, offset, end: offset + raw.length, line: text.slice(0, offset).split('\n').length, kind: 'link', replacement: '`' + raw + '`' });
    }
    links.sort((a,b) => a.offset-b.offset);
    return { links, ignored, uncertain };
}
