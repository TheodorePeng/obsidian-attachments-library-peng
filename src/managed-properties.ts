import { stringifyYaml } from 'obsidian';
import { readDocument } from './registry';
export const MANAGED_TYPES: Readonly<Record<string,string>> = { attachment:'text', url:'text', keep:'checkbox', _filePath:'text', _fileType:'text', al_schema:'number', al_usageCount:'number', al_usageState:'text' };
const own=(m:Record<string,unknown>,key:string)=>Object.prototype.hasOwnProperty.call(m,key) === true;
export function isSafeUrl(value:unknown):value is string {
    if(typeof value!=='string'||!/^[a-z][a-z0-9+.-]*:/i.test(value.trim()))return false;
    try{return !['javascript:','data:','vbscript:','file:','blob:','about:','filesystem:','chrome:','devtools:','app:','resource:'].includes(new URL(value.trim()).protocol.toLowerCase());}catch{return false;}
}
export function effectiveUrl(m:Record<string,unknown>):string { return own(m,'url') ? typeof m.url==='string'?m.url:'' : m.al_schema!==2 && typeof m.source==='string' && isSafeUrl(m.source)?m.source:''; }
export function effectiveKeep(m:Record<string,unknown>):boolean {
    if(m.keep===true||m.al_keep===true)return true;
    if(own(m,'keep')&&typeof m.keep!=='boolean'||own(m,'al_keep')&&typeof m.al_keep!=='boolean')return true;
    return m.al_schema===2&&!own(m,'keep');
}
export function managedIssues(m:Record<string,unknown>):string[] {
    const errors:string[]=[];
    if(own(m,'keep')&&typeof m.keep!=='boolean'||own(m,'al_keep')&&typeof m.al_keep!=='boolean')errors.push('Invalid keep value');
    if(own(m,'keep')&&own(m,'al_keep')&&m.keep!==m.al_keep)errors.push('keep and al_keep disagree');
    if(m.al_schema!==undefined&&m.al_schema!==1&&m.al_schema!==2)errors.push('Unsupported metadata schema');
    if(m.al_schema===2){
        for(const [key,type] of Object.entries(MANAGED_TYPES)){
            const value=m[key]; if(type==='text'?typeof value!=='string':type==='checkbox'?typeof value!=='boolean':typeof value!=='number'||!Number.isFinite(value))errors.push('Invalid or missing '+key);
        }
        if(typeof m.url==='string'&&m.url!==''&&!isSafeUrl(m.url))errors.push('Invalid URL');
        if(typeof m.al_usageCount==='number'&&(!Number.isInteger(m.al_usageCount)||m.al_usageCount<0))errors.push('Invalid usage count');
        if(!['unknown','used','orphan','missing','conflict','excluded'].includes(String(m.al_usageState)))errors.push('Invalid usage state');
    }
    return [...new Set(errors)];
}
export function newMetadata(path:string):Record<string,unknown> {return {attachment:'[['+path+']]',url:'',keep:false,_filePath:path,_fileType:path.split('.').pop()!.toLowerCase(),al_schema:2,al_usageCount:0,al_usageState:'unknown'};}
export function validateUserManaged(key:string,value:unknown):void {
    if((key==='keep'||key==='al_keep')&&typeof value!=='boolean')throw new Error('Keep must be a checkbox');
    if(key==='url'&&(typeof value!=='string'||value!==''&&!isSafeUrl(value)))throw new Error('Enter a valid URL or leave it empty');
}
/** Called only by an explicitly confirmed migration, never by normal refresh. */
export function migrationContent(text:string,path:string,cleanEmpty:boolean,retainLegacy=false):string {
    const {metadata:old,body}=readDocument(text); if(old.al_schema===2)return text;
    if(old.al_schema!==undefined&&old.al_schema!==1)throw new Error('Unsupported metadata schema');
    if(managedIssues(old).length)throw new Error(managedIssues(old).join('; '));
    if(own(old,'url')&&(typeof old.url!=='string'||old.url!==''&&!isSafeUrl(old.url)))throw new Error('Invalid URL');
    const oldUrl=isSafeUrl(old.source)?old.source:'';
    if(typeof old.url==='string'&&old.url&&oldUrl&&old.url!==oldUrl)throw new Error('Conflicting URL fields');
    const m:Record<string,unknown>={...old,...newMetadata(path),url:typeof old.url==='string'&&old.url?old.url:oldUrl,keep:effectiveKeep(old)};
    if(typeof old.al_usageCount==='number'&&Number.isInteger(old.al_usageCount)&&old.al_usageCount>=0)m.al_usageCount=old.al_usageCount;
    if(['unknown','used','orphan','missing','conflict','excluded'].includes(String(old.al_usageState)))m.al_usageState=old.al_usageState;
    const archive:Record<string,unknown>={};
    if(!retainLegacy){
        if(oldUrl)delete m.source;
        delete m.al_keep;
        const basename=path.split('/').pop()!.replace(/\.[^.]+$/,'');
        if(old.title!=null&&old.title!==''&&old.title!==basename)archive.title=old.title;
        if(old.status!=null&&old.status!==''&&old.status!=='unread')archive.status=old.status;
        for(const key of ['title','status','_heuristic'])delete m[key];
        if(cleanEmpty)for(const key of ['author','subject','genre','notes','created','updated','tags'])if(m[key]==null||m[key]===''||Array.isArray(m[key])&&!(m[key] as unknown[]).length)delete m[key];
    }
    const appendix=Object.keys(archive).length?'\n\n<!-- alp:legacy:start -->\n## Legacy metadata\n\n'+Object.entries(archive).map(([k,v])=>'- '+k+': '+JSON.stringify(v)).join('\n')+'\n<!-- alp:legacy:end -->\n':'';
    return '---\n'+stringifyYaml(m)+'---\n'+body+appendix;
}
