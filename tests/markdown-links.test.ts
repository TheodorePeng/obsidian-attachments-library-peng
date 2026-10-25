import { it, expect } from 'vitest';
import { parseMarkdownLinks } from '../src/markdown-links';
it('parses actual links and definitions while ignoring math, code and comments', () => {
    const parsed = parseMarkdownLinks('$[1-F(x)][1-F(y)]$ `[[code.png]]`\n\n$$\n[[math.png]]\n$$\n\n```md\n[[fence.png]]\n```\n<!-- [[comment.png]] -->\n\n![[图.png|200]] [x](<Folder name/a(1).png>) ![ref][id]\n\n[id]: target.pdf\n[missing][undefined]');
    expect(parsed.links.map(l => l.link)).toEqual(['图.png', 'Folder name/a(1).png', 'target.pdf']);
    expect(parsed.uncertain).toBe(false); expect(parsed.ignored.length).toBeGreaterThanOrEqual(4);
});
it('keeps local HTML conservative including unquoted attributes and ignores remote HTML', () => {
    expect(parseMarkdownLinks('<img src=a.png>').uncertain).toBe(true);
    expect(parseMarkdownLinks('<img src="https://example.com/a.png">').uncertain).toBe(false);
    expect(parseMarkdownLinks('<!-- <img src="a.png"> -->').uncertain).toBe(false);
});

it('protects HTML srcset, PDF objects and video posters when local targets may be hidden',()=>{
    expect(parseMarkdownLinks('<img srcset="https://example.com/a.png 1x, local.png 2x">').uncertain).toBe(true);
    expect(parseMarkdownLinks('<object data="local.pdf"></object>').uncertain).toBe(true);
    expect(parseMarkdownLinks('<video src="https://example.com/a.mp4" poster="local.png"></video>').uncertain).toBe(true);
});
