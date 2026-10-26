import { test } from 'vitest';
import assert from 'node:assert/strict';
import { selectAttachmentTarget } from '../src/target-selection.ts';

const cand = (path, from, to) => ({ path, from, to });

test('active attachment outranks index attachment, cursor hits and fallback', () => {
  const input = {
    activeAttachment: 'Library/A.png',
    activeIndexAttachment: 'Library/B.md',
    candidates: [cand('Library/C.png', 0, 10), cand('Library/D.png', 0, 10)],
    cursorOffset: 5,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'Library/A.png' });
});

test('usable index attachment outranks cursor hits', () => {
  const input = {
    activeAttachment: '   ',
    activeIndexAttachment: 'Library/B.md',
    candidates: [cand('Library/C.png', 0, 10)],
    cursorOffset: 5,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'Library/B.md' });
});

test('zero cursor hits ranges starting at zero', () => {
  const input = { candidates: [cand('Z.png', 0, 5), cand('W.png', 1, 5)], cursorOffset: 0 };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'Z.png' });
});

test('range boundaries are inclusive on both ends', () => {
  assert.deepEqual(
    selectAttachmentTarget({ candidates: [cand('A.png', 4, 9)], cursorOffset: 4 }),
    { kind: 'target', path: 'A.png' },
  );
  assert.deepEqual(
    selectAttachmentTarget({ candidates: [cand('A.png', 4, 9)], cursorOffset: 9 }),
    { kind: 'target', path: 'A.png' },
  );
  // Just outside every range: no hit, so the fallback offers all candidates.
  assert.deepEqual(
    selectAttachmentTarget({
      candidates: [cand('A.png', 4, 9), cand('B.png', 20, 30)],
      cursorOffset: 3,
    }),
    { kind: 'choose', paths: ['A.png', 'B.png'] },
  );
});

test('overlapping spans produce a chooser containing only hit paths', () => {
  const input = {
    candidates: [cand('A.png', 0, 10), cand('B.png', 5, 15), cand('C.png', 20, 30)],
    cursorOffset: 7,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'choose', paths: ['A.png', 'B.png'] });
});

test('overlapping hits keep first-seen candidate order', () => {
  const input = {
    candidates: [cand('B.png', 0, 10), cand('A.png', 2, 8), cand('B.png', 5, 15)],
    cursorOffset: 6,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'choose', paths: ['B.png', 'A.png'] });
});

test('repeated identical hit paths select once', () => {
  const input = {
    candidates: [cand('dup.png', 0, 10), cand('dup.png', 5, 15)],
    cursorOffset: 6,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'dup.png' });
});

test('fallback lists distinct usable paths in first-seen order', () => {
  const input = { candidates: [cand('B.png', 0, 1), cand('A.png', 2, 3), cand('B.png', 4, 5)] };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'choose', paths: ['B.png', 'A.png'] });
});

test('fallback with a single usable candidate selects it', () => {
  const input = { candidates: [cand('Only.png', 0, 1)], cursorOffset: 99 };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'Only.png' });
});

test('absent or nonfinite cursor falls back to every usable candidate', () => {
  const candidates = [cand('A.png', 0, 10), cand('B.png', 5, 15)];
  assert.deepEqual(
    selectAttachmentTarget({ candidates }),
    { kind: 'choose', paths: ['A.png', 'B.png'] },
  );
  for (const cursorOffset of [Number.NaN, Infinity, -Infinity]) {
    assert.deepEqual(
      selectAttachmentTarget({ candidates, cursorOffset }),
      { kind: 'choose', paths: ['A.png', 'B.png'] },
      `cursor ${cursorOffset}`,
    );
  }
});

test('invalid ranges never hit but still count as fallback candidates', () => {
  const candidates = [
    cand('Reversed.png', 10, 0),
    cand('NaN.png', Number.NaN, 5),
    cand('Inf.png', 0, Infinity),
    cand('NegInf.png', -Infinity, 0),
  ];
  assert.deepEqual(
    selectAttachmentTarget({ candidates, cursorOffset: 5 }),
    { kind: 'choose', paths: ['Reversed.png', 'NaN.png', 'Inf.png', 'NegInf.png'] },
  );
});

test('invalid ranges are ignored when a valid range hits', () => {
  const input = {
    candidates: [cand('Bad.png', 10, 0), cand('Good.png', 0, 10)],
    cursorOffset: 5,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'Good.png' });
});

test('empty and whitespace paths are never selected', () => {
  const input = {
    activeAttachment: '',
    activeIndexAttachment: '  ',
    candidates: [cand('', 0, 10), cand('   ', 0, 10), cand('Real.png', 0, 10)],
    cursorOffset: 5,
  };
  assert.deepEqual(selectAttachmentTarget(input), { kind: 'target', path: 'Real.png' });
  assert.deepEqual(
    selectAttachmentTarget({ candidates: [cand('', 0, 1), cand('  ', 2, 3)] }),
    { kind: 'none' },
  );
});

test('no usable options yields none', () => {
  assert.deepEqual(selectAttachmentTarget({ candidates: [] }), { kind: 'none' });
  assert.deepEqual(
    selectAttachmentTarget({ candidates: [], cursorOffset: 3 }),
    { kind: 'none' },
  );
});

test('paths keep exact Chinese text, case and whitespace', () => {
  assert.deepEqual(
    selectAttachmentTarget({ activeAttachment: ' 附件/图片.PNG ' }),
    { kind: 'target', path: ' 附件/图片.PNG ' },
  );
  const hit = {
    candidates: [cand('附件/电影.MP4', 0, 10), cand('NOTE.Md', 0, 10)],
    cursorOffset: 4,
  };
  assert.deepEqual(selectAttachmentTarget(hit), {
    kind: 'choose',
    paths: ['附件/电影.MP4', 'NOTE.Md'],
  });
});

test('input is never mutated and output arrays are fresh', () => {
  const candidates = Object.freeze([
    Object.freeze(cand('A.png', 0, 10)),
    Object.freeze(cand('B.png', 5, 15)),
  ]);
  const input = Object.freeze({
    activeAttachment: '  ',
    activeIndexAttachment: undefined,
    candidates,
    cursorOffset: 7,
  });
  const snapshot = JSON.stringify(input);

  const result = selectAttachmentTarget(input);

  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(result, { kind: 'choose', paths: ['A.png', 'B.png'] });
  assert.notEqual(result.paths, candidates);
  // Mutating the result must never leak back into the frozen input.
  result.paths.push('Injected.png');
  assert.equal(JSON.stringify(input), snapshot);
});
