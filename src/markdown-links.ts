import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
export interface ParsedLink { link: string; offset: number; line: number; kind: 'link' | 'embed'; }
export interface TextRange { from: number; to: number; }
export const externalLink = (link: string): boolean => /^(?:(?!file:|obsidian:)[a-z][\w+.-]*:|\/\/)/i.test(link);
export function parseMarkdownLinks(text: string): { links: ParsedLink[]; ignored: TextRange[]; uncertain: boolean } {
    const tree = fromMarkdown(text, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] });
    const links: ParsedLink[] = [], ignored: TextRange[] = [];
    let uncertain = false;
    const definitions = new Map<string, string>();
    type Node = { type: string; url?: string; identifier?: string; value?: string; children?: Node[]; position?: { start: { offset?: number; line: number }; end: { offset?: number } } };
    const define = (node: Node) => { if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url); node.children?.forEach(define); };
    define(tree);
    const visit = (node: Node) => {
        const from = node.position?.start.offset ?? 0, to = node.position?.end.offset ?? from;
        if (['code', 'inlineCode', 'math', 'inlineMath'].includes(node.type)) { ignored.push({ from, to }); return; }
        if (node.type === 'html') {
            const html = (node.value ?? '').replace(/<!--[\s\S]*?-->/g, '');
            if (!html.trim()) { ignored.push({ from, to }); return; }
            if (/<(?:img|image|audio|video|source|iframe|embed|object|a)\b/i.test(html)) {
                const attributes = [...html.matchAll(/\b(src|href|srcset|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)];
                if (!attributes.length || attributes.some(m => m[1].toLowerCase() === 'srcset' || !externalLink(m[2] ?? m[3] ?? m[4]))) uncertain = true;
            }
            return;
        }
        if (['link', 'image', 'linkReference', 'imageReference'].includes(node.type)) {
            const link = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? '');
            ignored.push({from, to});
            if (link) links.push({ link, offset: from, line: node.position?.start.line ?? 1, kind: node.type.startsWith('image') ? 'embed' : 'link' });
            return;
        }
        node.children?.forEach(visit);
    };
    visit(tree);
    // Obsidian wiki syntax is atomic even when its alias contains Markdown marks.
    for (const match of text.matchAll(/!?\[\[([^\]|]+)[^\]]*\]\]/g)) {
        const offset = match.index;
        if (ignored.some(range => offset >= range.from && offset < range.to)) continue;
        let escapes = 0; for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) escapes++;
        if (escapes % 2) continue;
        links.push({link: match[1], offset, line: text.slice(0, offset).split('\n').length, kind: match[0].startsWith('!') ? 'embed' : 'link'});
    }
    links.sort((a,b) => a.offset-b.offset);
    return { links, ignored, uncertain };
}
