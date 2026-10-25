import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBaseExpressions } from '../src/base-formulas.ts';

const TSNOTES = 'if(note["URL-TSNotes"],link(note["URL-TSNotes"],icon("play")),"")';

function rowsOf(entries) {
  return entries.map(([path, properties]) => ({ path, properties }));
}

test('TSNotes formula handles remote, missing and local rows', () => {
  const rows = rowsOf([
    ['remote.md', { 'URL-TSNotes': 'https://example.com/watch?v=1' }],
    ['missing.md', {}],
    ['local.md', { 'URL-TSNotes': 'Library/Video A.md' }],
  ]);
  const result = analyzeBaseExpressions({ TSNotes: TSNOTES }, rows);

  // Remote URL is kept unchanged; the caller resolves/excludes remote targets.
  assert.deepEqual(
    result.links.map((l) => [l.target, l.rowPath]),
    [
      ['https://example.com/watch?v=1', 'remote.md'],
      ['Library/Video A.md', 'local.md'],
    ],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, ['URL-TSNotes']);
});

test('constant formulas still produce links with no rows', () => {
  const result = analyzeBaseExpressions({ Cover: 'link("Note A")' }, []);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].target, 'Note A');
  assert.equal(result.links[0].formula, 'Cover');
  assert.equal(result.links[0].rowPath, undefined);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, []);
});

test('formula aliases resolve nested formulas as targets', () => {
  const formulas = {
    inner: 'note["URL"]',
    outer: 'formula.inner',
    main: 'link(formula.outer)',
  };
  const rows = rowsOf([['a.md', { URL: 'Target.md' }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => [l.target, l.formula]),
    [['Target.md', 'main']],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, ['URL']);
});

test('recursive formula cycles are reported as issues, not silent empties', () => {
  const formulas = { a: 'link(formula.b)', b: 'link(formula.a)' };
  const result = analyzeBaseExpressions(formulas, rowsOf([['x.md', {}]]));
  assert.equal(result.links.length, 0);
  assert.ok(result.issues.some((issue) => /cycle/i.test(issue.reason)));
});

test('property changes across rows change the collected targets', () => {
  const formulas = { Link: 'link(note["URL"])' };
  const before = analyzeBaseExpressions(
    formulas,
    rowsOf([['a.md', { URL: 'Old.md' }], ['b.md', { URL: 'Old.md' }]]),
  );
  assert.deepEqual(before.links.map((l) => l.target), ['Old.md', 'Old.md']);

  const after = analyzeBaseExpressions(
    formulas,
    rowsOf([['a.md', { URL: 'New.md' }], ['b.md', {}]]),
  );
  assert.deepEqual(
    after.links.map((l) => [l.target, l.rowPath]),
    [['New.md', 'a.md']],
  );
  // Missing property is null: a bare link() over it is an unusable target.
  assert.ok(after.issues.some((issue) => /not a usable string/i.test(issue.reason)));
  assert.deepEqual(after.dependencies, ['URL']);
});

test('if with a known condition evaluates only the reachable branch', () => {
  const formulas = {
    ShortCircuit: 'if(true, link("kept.md"), link(unknownFn()))',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['x.md', {}]]));
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['kept.md'],
  );
  // The unreachable branch was never evaluated: no unsupported-function issue.
  assert.deepEqual(result.issues, []);
});

test('unknown condition unions finite branches without uncertainty', () => {
  const formulas = {
    Either: 'if(formula.missingAlias, link("a.md"), link("b.md"))',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['x.md', {}]]));
  assert.deepEqual(
    result.links.map((l) => l.target).sort(),
    ['a.md', 'b.md'],
  );
  assert.deepEqual(result.issues, []);
});

test('unknown display expressions do not cause issues', () => {
  const formulas = {
    Cover: 'link(note["URL"], unknownDisplayFn(note["Label"]))',
  };
  const rows = rowsOf([['a.md', { URL: 'Target.md', Label: 'Hi' }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['Target.md'],
  );
  assert.deepEqual(result.issues, []);
});

test('string concatenation joins finite known scalars', () => {
  const formulas = {
    Joined: 'link("Library/" + note["Name"] + ".md")',
  };
  const rows = rowsOf([['a.md', { Name: 'Video' }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['Library/Video.md'],
  );
  assert.deepEqual(result.issues, []);
});

test('malformed syntax is reported as an issue', () => {
  const formulas = {
    Broken: 'link(note["URL"',
    AlsoBroken: 'link(note.URL])',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['a.md', { URL: 'x.md' }]]));
  assert.equal(result.links.length, 0);
  const malformed = result.issues.filter((issue) => issue.reason === 'malformed syntax');
  assert.equal(malformed.length, 2);
  assert.ok(malformed.some((issue) => issue.formula === 'Broken'));
  assert.ok(malformed.some((issue) => issue.formula === 'AlsoBroken'));
});

test('malicious function text is never executed', () => {
  let executed = false;
  const formulas = {
    Evil: 'link(({}).constructor.constructor("executed = true")())',
    Eval: 'eval("executed = true")',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['a.md', {}]]));
  assert.equal(executed, false);
  assert.equal(result.links.length, 0);
  assert.ok(result.issues.some((issue) => issue.reason === 'malformed syntax'));
  assert.ok(result.issues.some((issue) => /unsupported function "eval"/.test(issue.reason)));
});

test('only own properties are read; prototypes are never traversed', () => {
  const polluted = Object.create({ poisoned: 'evil.md' });
  polluted.clean = 'safe.md';
  const rows = [{ path: 'a.md', properties: polluted }];
  const formulas = {
    Cover: 'if(note["poisoned"], link(note["poisoned"]), "")',
    Own: 'link(note["clean"])',
    BuiltIn: 'if(note["toString"], link(note["toString"]), "")',
  };
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['safe.md'],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, ['clean', 'poisoned', 'toString']);
});

test('inputs are never mutated', () => {
  const formulas = Object.freeze({ Cover: 'link(note["URL"])' });
  const rowProperties = Object.freeze({ URL: 'Target.md' });
  const rows = Object.freeze([Object.freeze({ path: 'a.md', properties: rowProperties })]);
  const snapshot = JSON.stringify({ formulas, rows });

  const result = analyzeBaseExpressions(formulas, rows);

  assert.equal(JSON.stringify({ formulas, rows }), snapshot);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['Target.md'],
  );
});

test('unknown target computation produces an issue, not an empty success', () => {
  const formulas = { Cover: 'link(formula.nope)' };
  const result = analyzeBaseExpressions(formulas, rowsOf([['a.md', {}]]));
  assert.equal(result.links.length, 0);
  assert.ok(result.issues.some((issue) => /could not be determined|could not be fully determined/.test(issue.reason)));
});

test('links and dependencies are deduplicated', () => {
  const formulas = {
    Dup: 'if(note["Flag"], link("same.md"), link("same.md")) + link("same.md", "")',
  };
  const rows = rowsOf([['a.md', { Flag: true }], ['b.md', { Flag: false }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  const keys = result.links.map((l) => `${l.target}|${l.formula}|${l.rowPath}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(result.links.filter((l) => l.rowPath === 'a.md').length, 1);
  assert.deepEqual(result.dependencies, ['Flag']);
});
