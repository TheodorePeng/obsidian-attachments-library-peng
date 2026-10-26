// Standalone acceptance tests for src/gallery-config.ts.
// Run: node --experimental-strip-types --test tests/gallery-config.acceptance.mjs

import { it as test } from 'vitest';
import assert from 'node:assert/strict';

import {
	GALLERY_DEFAULT_ORDER,
	normalizeGalleryOptions,
} from '../src/gallery-config.ts';

test('GALLERY_DEFAULT_ORDER is the expected readonly list', () => {
	assert.deepEqual(GALLERY_DEFAULT_ORDER, [
		'file.name',
		'note.url',
		'note.keep',
	]);
	assert.equal(GALLERY_DEFAULT_ORDER.length, 3);
});

test('empty config yields all defaults', () => {
	assert.deepEqual(normalizeGalleryOptions({}), {
		cardSize: 240,
		cardGap: 12,
		contentPadding: 8,
		pageSize: 60,
		image: 'note.attachment',
		imageFit: 'contain',
		imageAspectRatio: '4:3',
		propertyLabels: true,
		showEmptyProperties: false,
	});
});

test('undefined values fall back to defaults', () => {
	const normalized = normalizeGalleryOptions({
		cardSize: undefined,
		image: undefined,
		imageFit: undefined,
		propertyLabels: undefined,
	});
	assert.equal(normalized.cardSize, 240);
	assert.equal(normalized.image, 'note.attachment');
	assert.equal(normalized.imageFit, 'contain');
	assert.equal(normalized.propertyLabels, true);
});

test('cardSize accepts finite numbers, rounds, and clamps to 160..480', () => {
	assert.equal(normalizeGalleryOptions({ cardSize: 300 }).cardSize, 300);
	assert.equal(normalizeGalleryOptions({ cardSize: 159.4 }).cardSize, 160);
	assert.equal(normalizeGalleryOptions({ cardSize: 159.6 }).cardSize, 160);
	assert.equal(normalizeGalleryOptions({ cardSize: 480.4 }).cardSize, 480);
	assert.equal(normalizeGalleryOptions({ cardSize: 1000 }).cardSize, 480);
	assert.equal(normalizeGalleryOptions({ cardSize: 160 }).cardSize, 160);
	assert.equal(normalizeGalleryOptions({ cardSize: 480 }).cardSize, 480);
	// invalid types / non-finite numbers -> default
	for (const bad of ['300', null, true, NaN, Infinity, -Infinity, {}, []]) {
		assert.equal(
			normalizeGalleryOptions({ cardSize: bad }).cardSize,
			240,
			`cardSize ${String(bad)} should default`,
		);
	}
});

test('cardGap rounds and clamps to 0..24', () => {
	assert.equal(normalizeGalleryOptions({ cardGap: 4 }).cardGap, 4);
	assert.equal(normalizeGalleryOptions({ cardGap: -0.4 }).cardGap, 0);
	assert.equal(normalizeGalleryOptions({ cardGap: 100 }).cardGap, 24);
	assert.equal(normalizeGalleryOptions({ cardGap: 23.6 }).cardGap, 24);
	for (const bad of ['8', null, NaN, Infinity]) {
		assert.equal(
			normalizeGalleryOptions({ cardGap: bad }).cardGap,
			12,
			`cardGap ${String(bad)} should default`,
		);
	}
});

test('contentPadding rounds and clamps to 0..24', () => {
	assert.equal(normalizeGalleryOptions({ contentPadding: 0 }).contentPadding, 0);
	assert.equal(normalizeGalleryOptions({ contentPadding: 24 }).contentPadding, 24);
	assert.equal(normalizeGalleryOptions({ contentPadding: -5 }).contentPadding, 0);
	assert.equal(normalizeGalleryOptions({ contentPadding: 30 }).contentPadding, 24);
	assert.equal(normalizeGalleryOptions({ contentPadding: 7.5 }).contentPadding, 8);
	for (const bad of [false, '8', NaN, Infinity]) {
		assert.equal(
			normalizeGalleryOptions({ contentPadding: bad }).contentPadding,
			8,
			`contentPadding ${String(bad)} should default`,
		);
	}
});

test('pageSize rounds and clamps to 1..200', () => {
	assert.equal(normalizeGalleryOptions({ pageSize: 42 }).pageSize, 42);
	assert.equal(normalizeGalleryOptions({ pageSize: 0 }).pageSize, 1);
	assert.equal(normalizeGalleryOptions({ pageSize: 0.4 }).pageSize, 1);
	assert.equal(normalizeGalleryOptions({ pageSize: 500 }).pageSize, 200);
	assert.equal(normalizeGalleryOptions({ pageSize: 1 }).pageSize, 1);
	assert.equal(normalizeGalleryOptions({ pageSize: 200 }).pageSize, 200);
	for (const bad of ['60', null, NaN, -Infinity]) {
		assert.equal(
			normalizeGalleryOptions({ pageSize: bad }).pageSize,
			60,
			`pageSize ${String(bad)} should default`,
		);
	}
});

test('image: null or blank string -> null, strings trimmed, invalid -> default', () => {
	assert.equal(normalizeGalleryOptions({ image: null }).image, null);
	assert.equal(normalizeGalleryOptions({ image: '' }).image, null);
	assert.equal(normalizeGalleryOptions({ image: '   ' }).image, null);
	assert.equal(normalizeGalleryOptions({ image: '  note.cover  ' }).image, 'note.cover');
	assert.equal(normalizeGalleryOptions({ image: 'note.banner' }).image, 'note.banner');
	for (const bad of [42, true, {}, []]) {
		assert.equal(
			normalizeGalleryOptions({ image: bad }).image,
			'note.attachment',
			`image ${String(bad)} should default`,
		);
	}
});

test('imageFit supports contain/cover only, else contain', () => {
	assert.equal(normalizeGalleryOptions({ imageFit: 'cover' }).imageFit, 'cover');
	assert.equal(normalizeGalleryOptions({ imageFit: 'contain' }).imageFit, 'contain');
	for (const bad of ['fill', 'COVER', '', null, 7]) {
		assert.equal(
			normalizeGalleryOptions({ imageFit: bad }).imageFit,
			'contain',
			`imageFit ${String(bad)} should default`,
		);
	}
});

test('imageAspectRatio supports listed ratios only, else 4:3', () => {
	for (const ratio of ['4:3', '1:1', '16:9', '3:4']) {
		assert.equal(
			normalizeGalleryOptions({ imageAspectRatio: ratio }).imageAspectRatio,
			ratio,
		);
	}
	for (const bad of ['2:3', '16/9', '', null, 1]) {
		assert.equal(
			normalizeGalleryOptions({ imageAspectRatio: bad }).imageAspectRatio,
			'4:3',
			`imageAspectRatio ${String(bad)} should default`,
		);
	}
});

test('boolean fields accept only booleans', () => {
	assert.equal(normalizeGalleryOptions({ propertyLabels: false }).propertyLabels, false);
	assert.equal(normalizeGalleryOptions({ showEmptyProperties: true }).showEmptyProperties, true);
	for (const bad of ['true', 1, 0, null, undefined]) {
		assert.equal(
			normalizeGalleryOptions({ propertyLabels: bad }).propertyLabels,
			true,
			`propertyLabels ${String(bad)} should default`,
		);
		assert.equal(
			normalizeGalleryOptions({ showEmptyProperties: bad }).showEmptyProperties,
			false,
			`showEmptyProperties ${String(bad)} should default`,
		);
	}
});

test('input record is never mutated', () => {
	const input = {
		cardSize: 300,
		image: '  note.x ',
		extra: 'ignored',
	};
	const snapshot = { ...input };
	const normalized = normalizeGalleryOptions(input);
	assert.deepEqual(input, snapshot);
	assert.notEqual(normalized, input);
});
