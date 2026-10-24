import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXTENSIONS,
  normalizeExtensions,
  classifyMedia,
  isEligiblePath,
} from '../src/file-policy.ts';

function makeSettings(overrides = {}) {
  return {
    indexScope: 'folder',
    attachmentsFolder: 'Attachments',
    libraryFolder: 'Library',
    watchedExtensions: DEFAULT_EXTENSIONS,
    ...overrides,
  };
}

test('DEFAULT_EXTENSIONS covers official native image, audio, video and PDF formats', () => {
  const expected = [
    '.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp',
    '.flac', '.m4a', '.mp3', '.ogg', '.wav',
    '.mp4', '.ogv', '.webm', '.mov', '.mkv', '.3gp',
    '.pdf',
  ];

  for (const ext of expected) {
    assert.ok(DEFAULT_EXTENSIONS.includes(ext), `missing ${ext}`);
  }

  assert.equal(DEFAULT_EXTENSIONS.includes('.md'), false);
});

test('normalizeExtensions trims, adds leading dot, lowercases and dedupes', () => {
  assert.deepEqual(
    normalizeExtensions(['PDF', ' .Png ', 'png', 'pdf', 'JPG']),
    ['.pdf', '.png', '.jpg'],
  );
});

test('normalizeExtensions drops empty and whitespace-only entries', () => {
  assert.deepEqual(normalizeExtensions(['', '  ', '.PDF']), ['.pdf']);
});

test('classifyMedia classifies image formats case-insensitively', () => {
  const images = ['a.png', 'B.JPG', 'c.Jpeg', 'd.gif', 'e.svg', 'f.webp', 'g.avif', 'h.bmp'];
  for (const path of images) {
    assert.equal(classifyMedia(path), 'image', path);
  }
});

test('classifyMedia classifies audio formats', () => {
  const audio = ['a.mp3', 'b.wav', 'c.ogg', 'd.flac', 'e.m4a'];
  for (const path of audio) {
    assert.equal(classifyMedia(path), 'audio', path);
  }
});

test('classifyMedia classifies video formats', () => {
  const video = ['a.mp4', 'b.webm', 'c.ogv', 'd.mov', 'e.mkv'];
  for (const path of video) {
    assert.equal(classifyMedia(path), 'video', path);
  }
});

test('classifyMedia classifies PDF and falls back to other', () => {
  assert.equal(classifyMedia('doc.pdf'), 'pdf');
  assert.equal(classifyMedia('DOC.PDF'), 'pdf');
  assert.equal(classifyMedia('note.md'), 'other');
  assert.equal(classifyMedia('archive.zip'), 'other');
  assert.equal(classifyMedia('no-extension'), 'other');
});

test('isEligiblePath always rejects markdown, base and canvas types', () => {
  for (const ext of ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'base', 'canvas']) {
    const path = `Attachments/note.${ext}`;

    assert.equal(
      isEligiblePath(path, makeSettings({ watchedExtensions: ['.' + ext] })),
      false,
      `${ext} folder scope`,
    );

    assert.equal(
      isEligiblePath(path, makeSettings({ indexScope: 'vault', watchedExtensions: ['.' + ext] })),
      false,
      `${ext} vault scope`,
    );
  }
});

test('isEligiblePath rejects hidden path segments', () => {
  assert.equal(isEligiblePath('Attachments/.hidden/photo.png', makeSettings()), false);
  assert.equal(isEligiblePath('.obsidian/app.json', makeSettings({ indexScope: 'vault' })), false);
  assert.equal(isEligiblePath('.hidden.png', makeSettings({ indexScope: 'vault' })), false);
  assert.equal(isEligiblePath('Attachments/photo.png', makeSettings()), true);
});

test('isEligiblePath rejects the library subtree but not lookalike folders', () => {
  const settings = makeSettings({ indexScope: 'vault' });

  assert.equal(isEligiblePath('Library/book.pdf', settings), false);
  assert.equal(isEligiblePath('Attachments/Library/book.pdf', settings), true);
  assert.equal(isEligiblePath('LibraryExtra/book.pdf', settings), true);
  assert.equal(isEligiblePath('Attachments/LibraryExtra/book.pdf', settings), true);
});

test('folder scope restricts candidates to the attachments folder', () => {
  const folder = makeSettings({ indexScope: 'folder' });

  assert.equal(isEligiblePath('Attachments/photo.png', folder), true);
  assert.equal(isEligiblePath('Other/photo.png', folder), false);
  assert.equal(isEligiblePath('Attachments2/photo.png', folder), false);

  const vault = makeSettings({ indexScope: 'vault' });
  assert.equal(isEligiblePath('Other/photo.png', vault), true);
});

test('isEligiblePath matches watched extensions case-insensitively', () => {
  const settings = makeSettings({ watchedExtensions: ['PDF', ' .Png '] });

  assert.equal(isEligiblePath('Attachments/doc.pdf', settings), true);
  assert.equal(isEligiblePath('Attachments/photo.PNG', settings), true);
  assert.equal(isEligiblePath('Attachments/song.mp3', settings), false);
});

test('isEligiblePath requires the extension to be watched', () => {
  const settings = makeSettings({ watchedExtensions: ['.png'] });

  assert.equal(isEligiblePath('Attachments/photo.png', settings), true);
  assert.equal(isEligiblePath('Attachments/doc.pdf', settings), false);
});

test('isEligiblePath preserves folder path case', () => {
  const settings = makeSettings({ indexScope: 'folder', attachmentsFolder: 'Attachments' });
  assert.equal(isEligiblePath('ATTACHMENTS/photo.png', settings), false);
});
