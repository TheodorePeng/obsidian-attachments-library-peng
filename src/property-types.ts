import { App } from 'obsidian';
import { MANAGED_TYPES } from './managed-properties';
import { AttachmentRegistry } from './registry';
import { OperationStore } from './operation-store';
interface NativeTypes { getAssignedWidget(name: string): string | undefined; setType(name: string, type: string): Promise<void>; }
export interface TypeCheck { available: boolean; missing: string[]; conflicts: { key: string; expected: string; assigned?: string; paths: string[] }[]; }
export class ManagedPropertyTypes {
    constructor(private app: App, private registry: AttachmentRegistry, private store: OperationStore) {}
    private native(): NativeTypes | null {
        const manager = (this.app as unknown as { metadataTypeManager?: Partial<NativeTypes> }).metadataTypeManager;
        return typeof manager?.getAssignedWidget === 'function' && typeof manager.setType === 'function' ? manager as NativeTypes : null;
    }
    check(): TypeCheck {
        const native = this.native();
        const result: TypeCheck = { available: !!native, missing: [], conflicts: [] };
        for (const [key, expected] of Object.entries(MANAGED_TYPES)) {
            const assigned = native?.getAssignedWidget(key);
            const paths = this.registry.metadataSnapshot().filter(([, m]) => Object.entries(m).some(([name, value]) => name.toLowerCase() === key.toLowerCase() && value != null && (expected === 'checkbox' ? typeof value !== 'boolean' : expected === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string'))).map(([path]) => path);
            if ((assigned && assigned !== expected) || paths.length) result.conflicts.push({ key, expected, assigned, paths });
            else if (!assigned) result.missing.push(key);
        }
        return result;
    }
    async register(): Promise<TypeCheck> {
        const result = this.check(), native = this.native();
        if (!native || !this.registry.mappingComplete) return result;
        if (result.missing.length) {
            const path = this.app.vault.configDir + '/types.json';
            const content = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : '';
            await this.store.save('register-managed-types', [{ path, content }], result);
            for (const key of result.missing) {
                // Recheck immediately before each global assignment. Never overwrite a concurrent type.
                const fresh = this.check();
                if (fresh.missing.includes(key)) await native.setType(key, MANAGED_TYPES[key]);
            }
        }
        return this.check();
    }
}
