import { DEFAULT_EXTENSIONS } from './file-policy';
export type UsageState = "unknown" | "used" | "orphan" | "missing" | "conflict" | "excluded";
export interface AttachmentsLibrarySettings {
    settingsVersion?: number;
    legacyIndexPaths?: string[];
    lastOperationReport?: { summary: string; recovery: string };
    defaultBasePath?: string;
    defaultViewName?: string;
    defaultViewOwner?: string;
    indexScope: "vault" | "folder";
    initialScanComplete: boolean;
    imageButtonAutoHide: boolean;
    imageClickMode: "index" | "nativeCmdClick";
    attachmentsFolder: string;
    libraryFolder: string;
    watchedExtensions: string[];
    autoCreateOnNew: boolean;
    autoDeleteOnRemove: boolean;
    mirrorFolderStructure: boolean;
    baseFolderPath: string;
    enablePdfMetadataExtraction: boolean;
    enableDoiIsbnLookup: boolean;
    autoCreateBaseFile: boolean;
    tagsPropertyName: string;
}
export interface AttachmentMetadata {
    attachment: string;
    url: string;
    keep: boolean;
    _filePath: string;
    _fileType: string;
    al_schema: 2;
    al_usageCount: number;
    al_usageState: UsageState;
    [customProperty: string]: unknown;
}
export const DEFAULT_METADATA = { url: '', keep: false };
export const DEFAULT_SETTINGS: AttachmentsLibrarySettings = {
    settingsVersion: 2,
    legacyIndexPaths: [],
    defaultBasePath: "",
    defaultViewName: "",
    defaultViewOwner: "",
    indexScope: "vault",
    initialScanComplete: false,
    imageClickMode: "index",
    imageButtonAutoHide: true,
    attachmentsFolder: "Attachments",
    libraryFolder: "Library",
    watchedExtensions: [...DEFAULT_EXTENSIONS],
    autoCreateOnNew: false,
    autoDeleteOnRemove: false,
    mirrorFolderStructure: true,
    baseFolderPath: "",
    enablePdfMetadataExtraction: false,
    enableDoiIsbnLookup: false,
    autoCreateBaseFile: false,
    tagsPropertyName: "tags",
};
