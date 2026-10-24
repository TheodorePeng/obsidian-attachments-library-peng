export const DEFAULT_EXTENSIONS: string[] = [
    '.avif',
    '.bmp',
    '.gif',
    '.jpeg',
    '.jpg',
    '.png',
    '.svg',
    '.webp',
    '.flac',
    '.m4a',
    '.mp3',
    '.ogg',
    '.wav',
    '.mp4',
    '.ogv',
    '.webm',
    '.mov',
    '.mkv',
    '.3gp',
    '.pdf',
];
const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
    'md',
    'markdown',
    'mdown',
    'mkd',
    'mkdn',
    'mdwn',
    'mkdown',
    'mdtxt',
    'mdtext',
    'rmd',
    'qmd',
    'mdx',
    'base',
    'canvas',
]);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
    'avif',
    'bmp',
    'gif',
    'jpeg',
    'jpg',
    'png',
    'svg',
    'webp',
]);
const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
    '3gp',
    'flac',
    'm4a',
    'mp3',
    'ogg',
    'wav',
]);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
    'mp4',
    'ogv',
    'webm',
    'mov',
    'mkv',
]);
export function normalizeExtensions(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === '')
            continue;
        const normalized = trimmed.startsWith('.') ? trimmed : '.' + trimmed;
        if (BLOCKED_EXTENSIONS.has(normalized.slice(1)) || seen.has(normalized))
            continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
function getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot < 0)
        return '';
    return path.slice(lastDot + 1).toLowerCase();
}
export function classifyMedia(path: string): 'image' | 'audio' | 'video' | 'pdf' | 'other' {
    const extension = getExtension(path);
    if (IMAGE_EXTENSIONS.has(extension))
        return 'image';
    if (AUDIO_EXTENSIONS.has(extension))
        return 'audio';
    if (VIDEO_EXTENSIONS.has(extension))
        return 'video';
    if (extension === 'pdf')
        return 'pdf';
    return 'other';
}
function hasHiddenSegment(path: string): boolean {
    return path.split('/').some(segment => segment.startsWith('.'));
}
function isWithinFolder(path: string, folder: string): boolean {
    if (folder === '')
        return false;
    return path === folder || path.startsWith(folder + '/');
}
export function isEligiblePath(path: string, settings: {
    indexScope: 'vault' | 'folder';
    attachmentsFolder: string;
    libraryFolder: string;
    watchedExtensions: string[];
}): boolean {
    if (hasHiddenSegment(path))
        return false;
    if (isWithinFolder(path, settings.libraryFolder))
        return false;
    const extension = getExtension(path);
    if (BLOCKED_EXTENSIONS.has(extension))
        return false;
    if (settings.indexScope === 'folder' &&
        !isWithinFolder(path, settings.attachmentsFolder)) {
        return false;
    }
    const watched = normalizeExtensions(settings.watchedExtensions);
    return watched.includes('.' + extension);
}
