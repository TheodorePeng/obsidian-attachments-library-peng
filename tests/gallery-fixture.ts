import { vi } from 'vitest';
import { StringValue, BooleanValue, NumberValue, ListValue, NullValue, LinkValue } from 'obsidian';
import { AttachmentRegistry, readDocument } from '../src/registry';
import { ReferenceService } from '../src/references';
import { SidecarManager } from '../src/sidecar-manager';
import { DeletionService } from '../src/deletions';
import { GalleryPropertyEdits } from '../src/property-edits';
import { AttachmentsLibraryView } from '../src/library-view';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture } from './fixture';
export async function galleryFixture(contents: Record<string,string>={},overrides:any={}) {
    const f=fixture({'a.png':'x','Library/a.md':'---\n_filePath: a.png\nattachment: "[[a.png]]"\ntitle: 数学\nsource: https://example.com\nal_keep: false\nzero: 0\nflag: false\nempty: []\n---\nOCR 留存\n',...contents});
    const settings={...DEFAULT_SETTINGS,...overrides};const registry=new AttachmentRegistry(f.app,settings);await registry.refresh();const references=new ReferenceService(f.app,registry);await references.refresh();const sidecarManager=new SidecarManager(f.app,settings,registry);const deletions=new DeletionService(f.app,registry,references);const propertyEdits=new GalleryPropertyEdits(f.app,registry);deletions.hasPendingEdits=path=>propertyEdits.hasPending(path);propertyEdits.isDeleting=path=>deletions.ownsPath(path);const refreshUsage=vi.fn(async()=>{await registry.refresh();await references.refresh();});return {...f,settings,registry,references,sidecarManager,deletions,propertyEdits,refreshUsage};
}
export function galleryEntry(s:any,file:any) {return {file,getValue:(id:string)=>{
    const key=id.startsWith('note.')?id.slice(5):id;
    const raw=id==='file.name'?file.basename:id.startsWith('formula.')?'formula result':id==='file.size'?file.stat.size:readDocument(s.data.get(file.path)??'').metadata[key];
    if(raw==null)return new NullValue();if(Array.isArray(raw))return new ListValue(raw);if(typeof raw==='boolean')return new BooleanValue(raw);if(typeof raw==='number')return new NumberValue(raw);if(typeof raw==='string'&&/^(?:https?:|marginnote)/.test(raw))return new LinkValue(raw);return new StringValue(raw);
}};}
export function galleryView(s:any,root:HTMLElement,options:any={},entries?:any[]) {
 const rows=entries??[...s.registry.byIndex.keys()].map((p:any)=>galleryEntry(s,s.files.get(p)));
 const config={get:(k:string)=>options[k],getOrder:()=>options.order??['file.name','note.created','note.source'],getDisplayName:(id:string)=>options.labels?.[id]??id.replace(/^\w+\./,'')};
 const controller:any={app:s.app,config,data:{groupedData:[{entries:rows,key:{toString:()=>options.group??''},hasKey:()=>!!options.group}]}};
 const view=new AttachmentsLibraryView(controller,root,s);return {view,controller,options};
}
