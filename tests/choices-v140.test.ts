// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { modalInstances, settingInstances } from 'obsidian';
import { chooseItem, enterPath } from '../src/choices';
it('searchable file picker returns only explicit choices and cancels safely',async()=>{const result=chooseItem({} as any,'Pick',['A.base','folder/B.base']);const picker=modalInstances.at(-1);expect(picker.getSuggestions('b')).toEqual(['A.base','folder/B.base']);expect(picker.getSuggestions('folder')).toEqual(['folder/B.base']);const el=document.createElement('div');picker.renderSuggestion('A.base',el);expect(el.textContent).toBe('A.base');picker.onChooseSuggestion('A.base');picker.close();expect(await result).toBe('A.base');const cancel=chooseItem({} as any,'Pick',[]);modalInstances.at(-1).close();expect(await cancel).toBeNull();});
it('path input confirms current text, cancels and closes without writes',async()=>{const path=enterPath({} as any,'New Base','Default.base');settingInstances.at(-2).textCallbacks[0]('Custom.base');settingInstances.at(-1).buttonCallbacks[1]();expect(await path).toBe('Custom.base');const cancel=enterPath({} as any,'New Base','Default.base');settingInstances.at(-1).buttonCallbacks[0]();expect(await cancel).toBeNull();});

it('accepts the native close-before-choose callback order',async()=>{const result=chooseItem({} as any,'Pick',['A.base']);const picker=modalInstances.at(-1);picker.close();picker.onChooseSuggestion('A.base');expect(await result).toBe('A.base');});
