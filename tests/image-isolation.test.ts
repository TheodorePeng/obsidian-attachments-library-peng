// @vitest-environment happy-dom
import { it, expect, vi } from 'vitest';
import { ImageNavigation } from '../src/image-navigation';
import { AttachmentRegistry } from '../src/registry';
import { SidecarManager } from '../src/sidecar-manager';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
it('keeps the button outside the original embed and isolates both native hover paths', async () => {
    const f = fixture({ 'a.png': 'x', 'Library/a.md': '---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n' });
    const settings = { ...DEFAULT_SETTINGS }; const registry = new AttachmentRegistry(f.app, settings); await registry.refresh();
    const images = new ImageNavigation(f.app, settings, registry, new SidecarManager(f.app, settings, registry));
    const root = document.createElement('div'); document.body.append(root);
    const host = root.createEl('span', { cls: 'internal-embed is-loaded', attr: { src: 'a.png|200' } }); host.createEl('img');
    const raw = vi.fn(), link = vi.fn(); root.addEventListener('mouseover', e => { if ((e.target as Element).closest('.internal-embed')) raw(); if ((e.target as Element).closest('.internal-link')) link(); });
    const stop = images.observe(root, () => 'note.md');
    const anchor = root.querySelector<HTMLAnchorElement>('.alp-image-link')!;
    expect(host.contains(anchor)).toBe(false); expect(anchor.previousElementSibling).toBe(host);
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));
    expect(raw).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled(); expect(f.app.workspace.trigger).toHaveBeenCalledTimes(1);
    expect(f.app.workspace.trigger).toHaveBeenCalledWith('hover-link', expect.objectContaining({ linktext: 'Library/a.md' }));
    anchor.dispatchEvent(new MouseEvent('mouseleave')); host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true })); expect(raw).toHaveBeenCalledOnce();
    stop(); expect(root.querySelector('.alp-image-link')).toBeNull(); expect(host.parentElement).toBe(root); images.dispose(); root.remove();
});
it('supports modifier pressed after pointer entry and delayed visibility without writes', async () => {
    vi.useFakeTimers(); const f = fixture({ 'a.png': 'x', 'Library/a.md': '---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n' }); const settings = { ...DEFAULT_SETTINGS };
    const registry = new AttachmentRegistry(f.app, settings); await registry.refresh(); const images = new ImageNavigation(f.app, settings, registry, new SidecarManager(f.app, settings, registry));
    const root = document.createElement('div'); document.body.append(root); const host = root.createEl('span', { cls: 'internal-embed', attr: { src: 'a.png' } }); host.createEl('img'); images.observe(root, () => 'n.md'); const anchor = root.querySelector<HTMLAnchorElement>('a')!;
    host.dispatchEvent(new MouseEvent('mouseenter')); expect(anchor.classList.contains('alp-image-visible')).toBe(true);
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    expect(f.app.workspace.trigger).toHaveBeenCalledTimes(2);
    anchor.dispatchEvent(new MouseEvent('mouseleave')); host.dispatchEvent(new MouseEvent('mouseleave')); await vi.advanceTimersByTimeAsync(199); expect(anchor.classList.contains('alp-image-visible')).toBe(true); await vi.advanceTimersByTimeAsync(1); expect(anchor.classList.contains('alp-image-visible')).toBe(false);
    expect(f.writes).toHaveLength(0); images.dispose(); root.remove(); vi.useRealTimers();
});
it('refreshes association targets, ignores remote/reused hosts, and retains the original host on disposal',async()=>{
    const f=fixture({'a.png':'x','b.png':'x','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n','Library/b.md':'---\n_filePath: b.png\nattachment: "[[b.png]]"\n---\n'});const settings={...DEFAULT_SETTINGS,imageButtonAutoHide:false};const registry=new AttachmentRegistry(f.app,settings);await registry.refresh();const images=new ImageNavigation(f.app,settings,registry,new SidecarManager(f.app,settings,registry));const root=document.createElement('div');document.body.append(root);const host=root.createEl('span',{cls:'internal-embed',attr:{src:'a.png'}});host.createEl('img');const stop=images.observe(root,()=> 'n.md');let anchor=root.querySelector<HTMLAnchorElement>('a')!;expect(anchor.classList.contains('alp-image-always')).toBe(true);host.setAttribute('src','b.png');images.refresh();expect(anchor.dataset.href).toBe('Library/b.md');host.setAttribute('src','https://example.com/image.png');images.refresh();expect(root.querySelector('a')).toBeNull();host.setAttribute('src','a.png');images.refresh();anchor=root.querySelector('a')!;anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));expect(f.app.workspace.getLeaf).toHaveBeenCalledWith(false);stop();images.dispose();expect(host.parentElement).toBe(root);root.remove();
});
it('does not resurrect images removed by the editor or renderer',async()=>{
    const f=fixture({'a.png':'x'});const registry=new AttachmentRegistry(f.app,{...DEFAULT_SETTINGS});await registry.refresh();const images=new ImageNavigation(f.app,{...DEFAULT_SETTINGS},registry,new SidecarManager(f.app,{...DEFAULT_SETTINGS},registry));const root=document.createElement('div');document.body.append(root);const host=root.createEl('span',{cls:'internal-embed',attr:{src:'a.png'}});host.createEl('img');images.decorate(root,'n.md');host.remove();images.decorate(root,'n.md');expect(root.querySelector('.internal-embed')).toBeNull();expect(root.querySelector('.alp-image-frame')).toBeNull();images.dispose();root.remove();
});
it('keeps a live hover trigger stable during focus-driven layout shifts and follows explicit scroll',async()=>{
    const f=fixture({'a.png':'x','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n'});const settings={...DEFAULT_SETTINGS};const registry=new AttachmentRegistry(f.app,settings);await registry.refresh();const images=new ImageNavigation(f.app,settings,registry,new SidecarManager(f.app,settings,registry));const root=document.createElement('div');document.body.append(root);const host=root.createEl('span',{cls:'internal-embed',attr:{src:'a.png'}});const img=host.createEl('img');let top=100,editorTop=0;
    root.getBoundingClientRect=()=>({left:0,top:editorTop,bottom:1000} as DOMRect);img.getBoundingClientRect=()=>({right:200,top,bottom:top+100,height:100,width:100} as DOMRect);
    const view={scrollDOM:root,requestMeasure:(m:any)=>m.write(m.read())} as any;images.observe(root,()=> 'n.md',undefined,view);const a=document.querySelector<HTMLAnchorElement>('.alp-editor-overlay a')!;expect(a.style.top).toBe('138px');a.getBoundingClientRect=()=>({left:174,top:138} as DOMRect);a.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,metaKey:true}));top=64;images.refresh();expect(a.style.top).toBe('138px');editorTop=-36;images.refresh();expect(a.style.top).toBe('138px');editorTop=0;root.dispatchEvent(new Event('scroll'));expect(a.style.top).toBe('102px');a.dispatchEvent(new MouseEvent('mouseleave'));top=90;images.refresh();expect(a.style.top).toBe('128px');images.dispose();root.remove();
});

it('clears a native image modifier candidate before a later Command key on the independent button',async()=>{
    const f=fixture({'a.png':'x','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\n---\n'});const settings={...DEFAULT_SETTINGS};const registry=new AttachmentRegistry(f.app,settings);await registry.refresh();const images=new ImageNavigation(f.app,settings,registry,new SidecarManager(f.app,settings,registry));const root=document.createElement('div');document.body.append(root);const host=root.createEl('span',{cls:'internal-embed',attr:{src:'a.png'}});host.createEl('img');images.observe(root,()=> 'n.md');let pending:string|null=null;const native=(e:MouseEvent)=>pending=(e.target as Element).closest('.internal-embed')?.getAttribute('src')??null;document.addEventListener('mouseover',native);host.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));expect(pending).toBe('a.png');const a=root.querySelector<HTMLAnchorElement>('a')!;a.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));expect(pending).toBeNull();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Meta',metaKey:true}));expect(f.app.workspace.trigger).toHaveBeenLastCalledWith('hover-link',expect.objectContaining({linktext:'Library/a.md'}));expect(a.classList.contains('internal-link')).toBe(false);document.removeEventListener('mouseover',native);images.dispose();root.remove();
});
