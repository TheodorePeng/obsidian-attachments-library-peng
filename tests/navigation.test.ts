import { expect, it } from 'vitest';
import { routeImageAction, safeSource } from '../src/image-navigation';
it('routes modifiers and mouse buttons explicitly', () => { expect(routeImageAction(0, false, 'index')).toBe('index'); expect(routeImageAction(0, true, 'index')).toBe('source'); expect(routeImageAction(1, false, 'index')).toBe('index-tab'); expect(routeImageAction(2, false, 'index')).toBe('menu'); expect(routeImageAction(0, true, 'nativeCmdClick')).toBe('native'); });
it('permits app and web source navigation but rejects executable URIs', () => { expect(safeSource('https://example.com')).toBe(true); expect(safeSource('obsidian://open?vault=Test')).toBe(true); expect(safeSource('javascript:alert(1)')).toBe(false); expect(safeSource('data:text/html,test')).toBe(false); });
