// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { modalInstances, settingInstances } from 'obsidian';
import { confirmDeletion, renderReview, showReferenceDetails } from '../src/delete-preview';
import { fixture } from './fixture';
it('renders protected reasons, all indexes and source locators without enabling deletion', async()=>{
    const f=fixture({}); const review:any={assetPath:'a.png',indexPaths:['Library/a.md','Library/duplicate.md'],hasUserBody:true,blockedReason:'duplicate',usage:{count:1,assetSources:['n.md'],indexSources:[],assetCheckComplete:false,indexCheckComplete:true,occurrences:[{sourcePath:'n.md',targetPath:'a.png',kind:'link',line:3,property:'related',nodeId:'node',formula:'Play'}],issues:[{sourcePath:'bad.base',reason:'Unknown expression',affectedPaths:null},{sourcePath:'scoped.md',reason:'Unresolved',affectedPaths:['a.png']}],excluded:[{sourcePath:'Library/a.md',targetPath:'a.png',kind:'property',property:'attachment'}]}};
    const plan:any={mode:'pair',targets:[],skipped:[{path:'a.png',reason:'duplicate'},{path:'missing',reason:'unknown'}],reviews:[review]};const result=confirmDeletion(f.app,plan);const modal=modalInstances.at(-1);expect(modal.contentEl.textContent).toContain('Library/duplicate.md');expect(modal.contentEl.textContent).toContain('Unknown expression');
    const links=modal.contentEl.querySelectorAll('a');links[3].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));expect(f.app.workspace.openLinkText).toHaveBeenCalledWith('n.md','',true,{eState:{line:2}});
    settingInstances.at(-1).buttonCallbacks[1]();modal.close();expect(await result).toBe(false);
    showReferenceDetails(f.app,review);modalInstances.at(-1).close();
    const root=document.createElement('div');renderReview(f.app,root,{assetPath:'missing',indexPaths:[],hasUserBody:false});expect(root.textContent).toContain('missing');
});
it('allows affirmative confirmation only for an eligible plan and supports normal cancellation', async()=>{
    const f=fixture({});const plan:any={mode:'metadata-only',targets:[{files:[{path:'Library/a.md'}]}],skipped:[],reviews:[]};const accepted=confirmDeletion(f.app,plan);settingInstances.at(-1).buttonCallbacks[1]();expect(await accepted).toBe(true);const canceled=confirmDeletion(f.app,plan);settingInstances.at(-1).buttonCallbacks[0]();expect(await canceled).toBe(false);
});
