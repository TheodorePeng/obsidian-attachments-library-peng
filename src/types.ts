import { DEFAULT_EXTENSIONS } from './file-policy';
export type UsageState = "unknown" | "used" | "orphan" | "missing" | "conflict" | "excluded";
export interface AttachmentsLibrarySettings {
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
    title: string;
    author: string;
    tags: string[];
    subject: string;
    genre: string;
    source: string;
    status: AttachmentStatus;
    notes: string;
    created: string;
    updated: string;
    _fileType: string;
    _filePath: string;
    _heuristic: boolean;
}
export type AttachmentStatus = "unread" | "reading" | "done" | "archived" | "discarded";
export const DEFAULT_METADATA: Omit<AttachmentMetadata, 'attachment' | 'created' | 'updated' | '_fileType' | '_filePath'> = {
    title: "",
    author: "",
    tags: [],
    subject: "",
    genre: "",
    source: "",
    status: "unread",
    notes: "",
    _heuristic: false,
};
export const DEFAULT_SETTINGS: AttachmentsLibrarySettings = {
    indexScope: "vault",
    initialScanComplete: false,
    imageClickMode: "index",
    imageButtonAutoHide: true,
    attachmentsFolder: "Attachments",
    libraryFolder: "Library",
    watchedExtensions: [...DEFAULT_EXTENSIONS],
    autoCreateOnNew: true,
    autoDeleteOnRemove: false,
    mirrorFolderStructure: true,
    baseFolderPath: "",
    enablePdfMetadataExtraction: true,
    enableDoiIsbnLookup: false,
    autoCreateBaseFile: false,
    tagsPropertyName: "tags",
};
