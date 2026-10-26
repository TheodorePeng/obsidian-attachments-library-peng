/**
 * Pure gallery view option normalization.
 *
 * No imports, no IO, no mutation of inputs. Deterministic defaults and
 * clamping for every gallery view option.
 */

/** Default note property order used by the gallery view. */
export const GALLERY_DEFAULT_ORDER: readonly string[] = [
	'file.name',
	'note.url',
	'note.keep',
];

/** Supported image fit modes. */
export type GalleryImageFit = 'contain' | 'cover';

/** Supported image aspect ratios. */
export type GalleryAspectRatio = '4:3' | '1:1' | '16:9' | '3:4';

/** Normalized gallery view options. */
export interface GalleryOptions {
	cardSize: number;
	cardGap: number;
	contentPadding: number;
	pageSize: number;
	image: string | null;
	imageFit: GalleryImageFit;
	imageAspectRatio: GalleryAspectRatio;
	propertyLabels: boolean;
	showEmptyProperties: boolean;
}

const DEFAULTS: GalleryOptions = {
	cardSize: 240,
	cardGap: 12,
	contentPadding: 8,
	pageSize: 60,
	image: 'note.attachment',
	imageFit: 'contain',
	imageAspectRatio: '4:3',
	propertyLabels: true,
	showEmptyProperties: false,
};

const CARD_SIZE_MIN = 160;
const CARD_SIZE_MAX = 480;
const GAP_PADDING_MIN = 0;
const GAP_PADDING_MAX = 24;
const PAGE_SIZE_MIN = 1;
const PAGE_SIZE_MAX = 200;

const IMAGE_FITS: readonly string[] = ['contain', 'cover'];
const ASPECT_RATIOS: readonly string[] = ['4:3', '1:1', '16:9', '3:4'];

function normalizeNumber(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	const rounded = Math.round(value);
	// Math.min/max clamping also normalizes -0 (from rounding -0.x) to +0.
	return Math.min(max, Math.max(min, rounded));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function normalizeImage(value: unknown, fallback: string | null): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== 'string') {
		return fallback;
	}
	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalize raw gallery view configuration into a complete GalleryOptions
 * object. The input record is never mutated.
 */
export function normalizeGalleryOptions(
	c: Record<string, unknown>,
): GalleryOptions {
	return {
		cardSize: normalizeNumber(
			c.cardSize,
			CARD_SIZE_MIN,
			CARD_SIZE_MAX,
			DEFAULTS.cardSize,
		),
		cardGap: normalizeNumber(
			c.cardGap,
			GAP_PADDING_MIN,
			GAP_PADDING_MAX,
			DEFAULTS.cardGap,
		),
		contentPadding: normalizeNumber(
			c.contentPadding,
			GAP_PADDING_MIN,
			GAP_PADDING_MAX,
			DEFAULTS.contentPadding,
		),
		pageSize: normalizeNumber(
			c.pageSize,
			PAGE_SIZE_MIN,
			PAGE_SIZE_MAX,
			DEFAULTS.pageSize,
		),
		image: normalizeImage(c.image, DEFAULTS.image),
		imageFit: IMAGE_FITS.includes(c.imageFit as string)
			? (c.imageFit as GalleryImageFit)
			: DEFAULTS.imageFit,
		imageAspectRatio: ASPECT_RATIOS.includes(c.imageAspectRatio as string)
			? (c.imageAspectRatio as GalleryAspectRatio)
			: DEFAULTS.imageAspectRatio,
		propertyLabels: normalizeBoolean(
			c.propertyLabels,
			DEFAULTS.propertyLabels,
		),
		showEmptyProperties: normalizeBoolean(
			c.showEmptyProperties,
			DEFAULTS.showEmptyProperties,
		),
	};
}
