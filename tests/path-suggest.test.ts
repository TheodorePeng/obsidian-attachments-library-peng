// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { PathSuggest } from '../src/path-suggest';
import { fixture } from './fixture';
it('filters by type, prioritizes prefixes and fills a draft without saving',()=>{
    const f=fixture({'Z/alpha.base':'','Alpha.base':'','no.md':'','.hidden/private.base':''}); f.folder('/');
    const input=document.createElement('input'), change=vi.fn(), suggest=new PathSuggest(f.app,input,'base',change);
    expect(suggest.getSuggestions('a')).toEqual(['Alpha.base','Z/alpha.base']); const el=document.createElement('div'); suggest.renderSuggestion('Z/alpha.base',el); expect(el.textContent).toBe('Z/alpha.base');
    suggest.selectSuggestion('Alpha.base',new MouseEvent('click')); expect(input.value).toBe('Alpha.base'); expect(change).toHaveBeenCalledWith('Alpha.base'); expect(f.writes).toEqual([]);
    const folders=new PathSuggest(f.app,input,'folder',change); expect(folders.getSuggestions('')).toEqual(['Z']); suggest.dispose(); folders.dispose();
});
it('guards composition Enter and removes its event listeners on disposal',()=>{
    const f=fixture({'A.base':''}), input=document.createElement('input'), change=vi.fn(), suggest=new PathSuggest(f.app,input,'base',change), next=vi.fn();
    input.dispatchEvent(new Event('compositionstart')); expect(suggest.getSuggestions('')).toEqual([]); input.addEventListener('keydown',next); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); expect(next).not.toHaveBeenCalled();
    suggest.selectSuggestion('A.base',new MouseEvent('click')); expect(change).not.toHaveBeenCalled(); input.dispatchEvent(new Event('compositionend'));
    suggest.selectSuggestion('A.base',new KeyboardEvent('keydown',{isComposing:true})); expect(change).not.toHaveBeenCalled(); suggest.selectSuggestion('A.base',new KeyboardEvent('keydown',{key:'Enter'})); expect(change).toHaveBeenCalledOnce();
    suggest.dispose(); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true})); expect(next).toHaveBeenCalledOnce();
});
