/**
 * Pure helper that decides which attachment a command should act on.
 *
 * The caller has already filtered eligibility and resolved real Vault paths;
 * this module only ranks the remaining options. It performs no IO, uses no
 * Obsidian API, and never mutates its input.
 *
 * Paths are opaque strings: a path is usable when it is non-empty after
 * trimming, but the original text (case, whitespace, Chinese characters) is
 * returned verbatim.
 */

export interface AttachmentCandidate {
    path: string;
    from: number;
    to: number;
}

export interface TargetInput {
    activeAttachment?: string;
    activeIndexAttachment?: string;
    candidates: readonly AttachmentCandidate[];
    cursorOffset?: number;
}

export type TargetSelection =
    | { kind: 'target'; path: string }
    | { kind: 'choose'; paths: string[] }
    | { kind: 'none' };

function isUsablePath(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

/** Only finite, ordered ranges can contain a cursor. */
function isOrderedFiniteRange(from: unknown, to: unknown): boolean {
    return typeof from === 'number' && typeof to === 'number'
        && Number.isFinite(from) && Number.isFinite(to) && from <= to;
}

/** Usable candidate paths deduplicated by exact text, in first-seen order. */
function distinctUsablePaths(candidates: readonly AttachmentCandidate[]): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate || !isUsablePath(candidate.path) || seen.has(candidate.path)) continue;
        seen.add(candidate.path);
        paths.push(candidate.path);
    }
    return paths;
}

/** One path is a direct target; several need a chooser; none is a no-op. */
function collapse(paths: readonly string[]): TargetSelection {
    if (paths.length === 1) return { kind: 'target', path: paths[0] };
    if (paths.length > 1) return { kind: 'choose', paths: [...paths] };
    return { kind: 'none' };
}

/**
 * Selects the attachment to act on, in priority order: the active attachment,
 * then its index note, then candidates whose finite ordered range contains the
 * cursor inclusively. Without a usable hit (or without a finite cursor) every
 * usable candidate is offered instead.
 */
export function selectAttachmentTarget(input: TargetInput): TargetSelection {
    if (isUsablePath(input.activeAttachment)) return { kind: 'target', path: input.activeAttachment };
    if (isUsablePath(input.activeIndexAttachment)) return { kind: 'target', path: input.activeIndexAttachment };

    const cursor = input.cursorOffset;
    if (typeof cursor === 'number' && Number.isFinite(cursor)) {
        const hits = new Set<string>();
        for (const candidate of input.candidates) {
            if (!candidate || !isUsablePath(candidate.path)) continue;
            if (!isOrderedFiniteRange(candidate.from, candidate.to)) continue;
            if (cursor >= candidate.from && cursor <= candidate.to) hits.add(candidate.path);
        }
        // A Set keeps first-seen insertion order, matching candidate order.
        if (hits.size > 0) return collapse([...hits]);
    }

    // No usable hit, or no usable cursor: offer every usable candidate.
    return collapse(distinctUsablePaths(input.candidates));
}
